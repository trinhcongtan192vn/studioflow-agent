import { existsSync, readFileSync } from 'node:fs';
import puppeteer, { type Page } from 'puppeteer-core';
import { SfError } from '../errors.js';
import { BuildGraph } from '../graph/graph.js';
import { killTree } from '../render/hf-render.js';
import { startHfStudio, syncSnapshot } from '../studio/preview.js';
import type { WriteStore } from '../store/writer.js';
import { timingOf } from '../workflow/duration.js';
import { runHf } from './cli.js';
import { loadOutputProfile } from './outputs.js';
import { resolveConfig } from '../config/resolve.js';
import { registerGateRepair, registerObjective, type GateContext } from '../workflow/gates.js';
import { applyFontFixes, type FontFix } from './text-fit.js';

export interface SafeAreaViolation {
  time_s: number;
  text: string;
  /** Hộp chữ (px, theo khung composition). */
  box: { x: number; y: number; w: number; h: number };
  sides: ('top' | 'right' | 'bottom' | 'left')[];
}

let chromePath: string | undefined;
async function chrome(): Promise<string> {
  if (chromePath) return chromePath;
  const r = await runHf(['browser', 'path'], { cwd: process.cwd(), timeoutMs: 120_000 });
  const p = r.stdout.trim().split(/\r?\n/).pop()?.trim();
  if (r.code !== 0 || !p)
    throw new SfError(
      'E_PROVIDER_UNAVAILABLE',
      `hyperframes browser path: ${r.stderr.slice(-300)}`,
    );
  chromePath = p;
  return p;
}

type Safe = { left: number; top: number; right: number; bottom: number };

/** Mở trang xem trước composition (bản chụp chỉ đọc) trong Chrome headless; `fn` nhận trang + vùng an toàn. */
async function withPreview<T>(
  store: WriteStore,
  videoId: string,
  profileId: string | null | undefined,
  empty: T,
  fn: (page: Page, safe: Safe, times: number[]) => Promise<T>,
): Promise<T> {
  const profile = loadOutputProfile(profileId ?? null);
  const timing = timingOf(store, videoId);
  const times = (timing?.frames ?? []).map(
    (f) => Math.round((f.start_ms + f.duration_ms / 2) / 10) / 100,
  );
  if (!times.length) return empty;
  const dir = syncSnapshot(store, videoId);
  const studio = await startHfStudio(dir);
  const browser = await puppeteer.launch({
    executablePath: await chrome(),
    headless: true,
    args: ['--hide-scrollbars'],
  });
  try {
    const listed = (await (await fetch(`http://127.0.0.1:${studio.port}/api/projects`)).json()) as {
      projects?: { id: string }[];
    };
    const id = listed.projects?.[0]?.id;
    if (!id) throw new SfError('E_STUDIO_PROCESS', 'hyperframes preview listed no project');
    const page = await browser.newPage();
    await page.setViewport({ width: profile.width, height: profile.height });
    await page.goto(`http://127.0.0.1:${studio.port}/api/projects/${id}/preview`, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => (window as { __playerReady?: boolean }).__playerReady === true,
      { timeout: 60_000 },
    );
    const sa = profile.safe_area;
    return await fn(
      page,
      {
        left: profile.width * sa.left,
        top: profile.height * sa.top,
        right: profile.width * (1 - sa.right),
        bottom: profile.height * (1 - sa.bottom),
      },
      times,
    );
  } finally {
    await browser.close().catch(() => {});
    if (studio.child.pid && studio.child.exitCode === null) killTree(studio.child.pid);
  }
}

/**
 * Chữ nằm trong `safe_area` của output profile (FN-030 mục 4, AC-M4-01): mở trang xem trước composition
 * của HyperFrames (bản chụp chỉ đọc) trong Chrome headless, tua tới giữa mỗi frame, đo hộp mọi đoạn chữ
 * đang hiện; chữ chạm ra ngoài vùng an toàn (dung sai 2 px) → vi phạm.
 */
export async function safeAreaViolations(
  store: WriteStore,
  videoId: string,
  opts: { profile?: string | null; signal?: AbortSignal } = {},
): Promise<SafeAreaViolation[]> {
  return withPreview(store, videoId, opts.profile, [], async (page, safe, times) => {
    const out: SafeAreaViolation[] = [];
    for (const t of times) {
      if (opts.signal?.aborted) throw new SfError('E_JOB_CANCELED', 'canceled');
      const boxes = await page.evaluate(async (time: number) => {
        const w = window as unknown as {
          __player: { seek(t: number): void };
          __hfWaitForSeekCompletion?: () => Promise<void>;
        };
        w.__player.seek(time);
        await (w.__hfWaitForSeekCompletion?.() ?? Promise.resolve());
        await new Promise((r) => setTimeout(r, 150));
        const root = document.querySelector('[data-composition-id]');
        const rr = root!.getBoundingClientRect();
        const res: { text: string; x: number; y: number; w: number; h: number }[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = (n.textContent ?? '').trim();
          const el = n.parentElement;
          if (!text || !el || el.closest('script,style,template,noscript')) continue;
          let hidden = false;
          for (let e: Element | null = el; e; e = e.parentElement) {
            const cs = getComputedStyle(e);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) {
              hidden = true;
              break;
            }
          }
          if (hidden) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const b = range.getBoundingClientRect();
          if (b.width < 1 || b.height < 1) continue;
          res.push({
            text: text.slice(0, 60),
            x: b.left - rr.left,
            y: b.top - rr.top,
            w: b.width,
            h: b.height,
          });
        }
        return res;
      }, t);
      for (const b of boxes) {
        const sides: SafeAreaViolation['sides'] = [];
        if (b.x < safe.left - 2) sides.push('left');
        if (b.y < safe.top - 2) sides.push('top');
        if (b.x + b.w > safe.right + 2) sides.push('right');
        if (b.y + b.h > safe.bottom + 2) sides.push('bottom');
        if (sides.length)
          out.push({
            time_s: t,
            text: b.text,
            box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) },
            sides,
          });
      }
    }
    return out;
  });
}

/**
 * Tự sửa chữ tràn vùng an toàn (0 token): trên trang xem trước, mỗi đoạn chữ của frame (không phải
 * caption/overlay, không phải frame ghim) đang tràn → thu nhỏ dần `font-size` của phần tử chứa nó (×0,92 mỗi
 * lần, không dưới 40% cỡ gốc) tới khi vừa; trả cỡ chữ cuối để ghi vào file frame. Thu không vừa → bỏ qua.
 */
export async function fitTextToSafeArea(
  store: WriteStore,
  videoId: string,
  opts: { profile?: string | null; skipFrames?: string[] } = {},
): Promise<FontFix[]> {
  return withPreview(store, videoId, opts.profile, [], async (page, safe, times) => {
    const fixes = new Map<string, FontFix>();
    for (const t of times) {
      const got: FontFix[] = await page.evaluate(
        async (time: number, sf: Safe, skip: string[]) => {
          const w = window as unknown as {
            __player: { seek(t: number): void };
            __hfWaitForSeekCompletion?: () => Promise<void>;
          };
          w.__player.seek(time);
          await (w.__hfWaitForSeekCompletion?.() ?? Promise.resolve());
          await new Promise((r) => setTimeout(r, 150));
          const rr = document.querySelector('[data-composition-id]')!.getBoundingClientRect();
          const frameOf = (el: Element) => {
            const id = el.closest('[data-composition-id]')?.getAttribute('data-composition-id');
            return id && /^fr_[0-9a-z]{8}$/.test(id) && !skip.includes(id) ? id : undefined;
          };
          const visible = (el: Element) => {
            for (let e: Element | null = el; e; e = e.parentElement) {
              const cs = getComputedStyle(e);
              if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05)
                return false;
            }
            return true;
          };
          const outside = (n: Node) => {
            const range = document.createRange();
            range.selectNodeContents(n);
            const b = range.getBoundingClientRect();
            if (b.width < 1 || b.height < 1) return false;
            const x = b.left - rr.left;
            const y = b.top - rr.top;
            return (
              x < sf.left - 2 ||
              y < sf.top - 2 ||
              x + b.width > sf.right + 2 ||
              y + b.height > sf.bottom + 2
            );
          };
          const given = new Set<Node>();
          const out: FontFix[] = [];
          for (let round = 0; round < 30; round++) {
            let hit: { n: Node; el: HTMLElement; frame: string } | undefined;
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n && !hit; n = walker.nextNode()) {
              const el = n.parentElement;
              if (!(n.textContent ?? '').trim() || !el || given.has(n)) continue;
              if (el.closest('script,style,template,noscript')) continue;
              const frame = frameOf(el);
              if (frame && visible(el) && outside(n)) hit = { n, el, frame };
            }
            if (!hit) break;
            const { n, el, frame } = hit;
            const from = parseFloat(getComputedStyle(el).fontSize);
            let fs = from;
            while (outside(n) && fs > from * 0.4) {
              fs = Math.floor(fs * 0.92);
              el.style.fontSize = `${fs}px`;
            }
            if (outside(n)) {
              el.style.fontSize = '';
              given.add(n);
              continue;
            }
            const own = [...el.childNodes]
              .filter((c) => c.nodeType === Node.TEXT_NODE)
              .map((c) => c.textContent ?? '')
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
            const sfId = el.getAttribute('data-sf-id') ?? undefined;
            const anchor = el.parentElement?.closest('[data-sf-id]')?.getAttribute('data-sf-id');
            out.push({
              frame_id: frame,
              ...(sfId ? { sf_id: sfId } : anchor ? { anchor_sf_id: anchor } : {}),
              tag: el.tagName.toLowerCase(),
              cls: el.getAttribute('class') ?? '',
              text: own.slice(0, 40),
              from_px: from,
              font_px: fs,
            });
          }
          return out;
        },
        t,
        safe,
        opts.skipFrames ?? [],
      );
      for (const f of got) {
        const k = [f.frame_id, f.sf_id, f.anchor_sf_id, f.tag, f.cls, f.text].join('|');
        const prev = fixes.get(k);
        fixes.set(k, prev ? { ...f, from_px: prev.from_px } : f);
      }
    }
    return [...fixes.values()];
  });
}

const profileOf = (g: GateContext) =>
  resolveConfig(
    'output.profile',
    { channelDir: g.store.root, videoId: g.videoId },
    { appDataDir: g.appDataDir },
  ).value as string | null;

// gate `text_safe_area` (030): chữ trong vùng an toàn của output profile của video
registerObjective('text_safe_area', async (g) => {
  const v = await safeAreaViolations(g.store, g.videoId, { profile: profileOf(g) });
  return v.length
    ? {
        pass: false,
        detail: v
          .slice(0, 6)
          .map((x) => `${x.time_s}s "${x.text}" outside safe area (${x.sides.join('/')})`)
          .join('; '),
      }
    : { pass: true };
});

// tự sửa: thu nhỏ đúng phần tử chữ tràn trong file frame; frame ghim (người dùng chỉnh tay) giữ nguyên
registerGateRepair('text_safe_area', async (g) => {
  const fixes = await fitTextToSafeArea(g.store, g.videoId, {
    profile: profileOf(g),
    skipFrames: Object.keys(g.state.pinned_frames ?? {}),
  });
  if (!fixes.length) return undefined;
  const v = `videos/${g.videoId}`;
  const notes: string[] = [];
  const changed: string[] = [];
  for (const fr of new Set(fixes.map((f) => f.frame_id))) {
    const rel = `${v}/compositions/frames/${fr}.html`;
    if (!existsSync(g.store.abs(rel))) continue;
    const r = applyFontFixes(
      readFileSync(g.store.abs(rel), 'utf8'),
      fixes.filter((f) => f.frame_id === fr),
    );
    if (!r.applied.length) continue;
    g.store.write(rel, r.html, { by: 'safe-area-fit', validate: false });
    changed.push(fr);
    notes.push(
      `${fr}: ${r.applied.map((f) => `"${f.text}" ${f.from_px}→${f.font_px}px`).join(', ')}`,
    );
  }
  if (!changed.length) return undefined;
  const graph = new BuildGraph({ store: g.store, appDataDir: g.appDataDir, builders: g.builders });
  graph.markBuilt(
    g.videoId,
    changed.map((fr) => `frame_html:${fr}`),
    { contentOnly: true },
  );
  await graph.build(g.videoId, { targets: ['index'] });
  return `thu nhỏ chữ tràn vùng an toàn — ${notes.join('; ')}`;
});
