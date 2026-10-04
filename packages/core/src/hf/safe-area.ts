import puppeteer from 'puppeteer-core';
import { SfError } from '../errors.js';
import { killTree } from '../render/hf-render.js';
import { startHfStudio, syncSnapshot } from '../studio/preview.js';
import type { WriteStore } from '../store/writer.js';
import { timingOf } from '../workflow/duration.js';
import { runHf } from './cli.js';
import { loadOutputProfile } from './outputs.js';
import { resolveConfig } from '../config/resolve.js';
import { registerObjective } from '../workflow/gates.js';

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
  const profile = loadOutputProfile(opts.profile ?? null);
  const timing = timingOf(store, videoId);
  const times = (timing?.frames ?? []).map(
    (f) => Math.round((f.start_ms + f.duration_ms / 2) / 10) / 100,
  );
  if (!times.length) return [];
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
      {
        timeout: 60_000,
      },
    );
    const sa = profile.safe_area;
    const safe = {
      left: profile.width * sa.left,
      top: profile.height * sa.top,
      right: profile.width * (1 - sa.right),
      bottom: profile.height * (1 - sa.bottom),
    };
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
  } finally {
    await browser.close().catch(() => {});
    if (studio.child.pid && studio.child.exitCode === null) killTree(studio.child.pid);
  }
}

// gate `text_safe_area` (030): chữ trong vùng an toàn của output profile của video
registerObjective('text_safe_area', async (g) => {
  const profile = resolveConfig(
    'output.profile',
    { channelDir: g.store.root, videoId: g.videoId },
    { appDataDir: g.appDataDir },
  ).value as string | null;
  const v = await safeAreaViolations(g.store, g.videoId, { profile });
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
