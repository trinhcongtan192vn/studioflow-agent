import { useEffect, useState } from 'react';
import type { DailyPlan, PlanJobResult } from '@studioflow/core';
import { core } from './rpc';
import { timeOf } from './session-format';

type Card = Awaited<ReturnType<typeof core.call<'video.list'>>>['videos'][number];
type Managed = Awaited<ReturnType<typeof core.call<'channels.managed'>>>['channels'][number];
type Item = DailyPlan['items'][number];
interface Ideas {
  channel: Managed;
  /** Đang lập bản xem thử (chưa có kế hoạch hôm nay) → thông báo tiến độ. */
  pending?: string;
  error?: string;
  date?: string;
  /** Bản xem thử chưa lưu (truyền lại khi tạo video). */
  preview?: DailyPlan;
  items: Item[];
}

const PER_CHANNEL = 3;
// một job xem thử cho mỗi kênh mỗi ngày trong một lần chạy app (effect chạy lại không lập lại)
const running = new Map<string, Promise<DailyPlan | undefined>>();
const cacheKey = (dir: string, date: string) => `sf.home.preview.${dir}.${date}`;
const today = () => new Date().toISOString().slice(0, 10);

const open = (plan: DailyPlan | null | undefined): Item[] =>
  (plan?.items ?? [])
    .filter((i) => !i.video_id && ['planned', 'skipped'].includes(i.status))
    .sort((a, b) => b.score - a.score)
    .slice(0, PER_CHANNEL);

function readCache(dir: string): DailyPlan | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(dir, today()));
    return raw ? (JSON.parse(raw) as DailyPlan) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(dir: string, plan: DailyPlan): void {
  try {
    localStorage.setItem(cacheKey(dir, today()), JSON.stringify(plan));
  } catch {
    /* bộ nhớ trình duyệt bị chặn → lần sau lập lại */
  }
}

/** Lập bản xem thử kế hoạch cho một kênh (job nền) và chờ xong; `onProgress` nhận thông báo của job. */
function previewPlan(dir: string, onProgress: (m: string) => void): Promise<DailyPlan | undefined> {
  const key = cacheKey(dir, today());
  const had = running.get(key);
  if (had) return had;
  const p = (async () => {
    const { job_id } = await core.call('autopilot.plan.preview', { channel: dir });
    for (;;) {
      const { job } = await core.call('job.get', { job_id });
      if (job.status === 'queued' || job.status === 'running') {
        onProgress(job.progress.message ?? 'Đang nghiên cứu đối thủ…');
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (job.status !== 'succeeded') throw new Error(job.error?.message ?? 'Lập gợi ý bị hủy.');
      const plan = (job.result as PlanJobResult).plans[0]?.plan;
      if (plan) writeCache(dir, plan);
      return plan;
    }
  })();
  running.set(key, p);
  p.catch(() => running.delete(key));
  return p;
}

/**
 * Màn "chat mới" của kênh (chưa chọn video): video làm gần đây và gợi ý nội dung theo kế hoạch của các kênh có
 * đối thủ — kênh chưa có kế hoạch hôm nay thì lập bản xem thử ngay (hiện tiến độ).
 */
export function ChatHome({
  channel,
  onOpenVideo,
}: {
  channel: string;
  onOpenVideo: (channel: string, video: string) => void;
}) {
  const [recent, setRecent] = useState<Card[]>();
  const [ideas, setIdeas] = useState<Ideas[]>();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    void core
      .call('video.list', { channel })
      .then((r) => {
        if (!alive) return;
        setRecent(
          [...r.videos]
            .filter((v) => v.status !== 'done')
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .slice(0, 3),
        );
      })
      .catch(() => alive && setRecent([]));
    const put = (dir: string, patch: Partial<Ideas>) =>
      alive &&
      setIdeas((all) => all?.map((x) => (x.channel.path === dir ? { ...x, ...patch } : x)));
    void (async () => {
      const managed = (await core.call('channels.managed', {})).channels.filter(
        (c) => c.exists && c.competitors > 0,
      );
      if (!alive) return;
      setIdeas(managed.map((c) => ({ channel: c, items: [] })));
      for (const c of managed) {
        try {
          const saved = (await core.call('autopilot.plan.get', { channel: c.path })).plans[0];
          if (saved?.plan && open(saved.plan).length) {
            put(c.path, { date: saved.plan.date, items: open(saved.plan) });
            continue;
          }
          const cached = readCache(c.path);
          if (cached) {
            put(c.path, { date: cached.date, preview: cached, items: open(cached) });
            continue;
          }
          put(c.path, { pending: 'Chưa có kế hoạch hôm nay — đang lập gợi ý từ kênh đối thủ…' });
          const plan = await previewPlan(c.path, (m) => put(c.path, { pending: m }));
          put(c.path, {
            pending: undefined,
            ...(plan ? { date: plan.date, preview: plan, items: open(plan) } : {}),
            ...(plan && !open(plan).length
              ? { error: plan.notes?.[0] ?? 'Chưa có chủ đề phù hợp hôm nay.' }
              : {}),
          });
        } catch (e) {
          put(c.path, { pending: undefined, error: (e as Error).message });
        }
      }
    })().catch(() => alive && setIdeas([]));
    return () => {
      alive = false;
    };
  }, [channel]);

  const create = async (x: Ideas, it: Item) => {
    if (busy) return;
    setBusy(it.id);
    setMsg('');
    try {
      const r = await core.call('autopilot.plan.create_video', {
        channel: x.channel.path,
        date: x.date ?? today(),
        item_id: it.id,
        ...(x.preview ? { preview: x.preview } : {}),
      });
      onOpenVideo(x.channel.path, r.video_id);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="chat-home" data-testid="chat-home">
      <h2>Bắt đầu từ đâu?</h2>
      <p className="muted">
        Hỏi agent về kênh ở ô bên dưới, mở lại video đang làm, hoặc chọn một gợi ý.
      </p>
      {msg && <p className="error">{msg}</p>}
      {recent && recent.length > 0 && (
        <section>
          <h4>🎬 Video đang làm gần đây</h4>
          <div className="home-cards">
            {recent.map((v) => (
              <button
                key={v.id}
                className="home-card"
                data-testid="home-recent"
                onClick={() => onOpenVideo(channel, v.id)}
              >
                <b>{v.title}</b>
                <span className="muted">
                  {v.current ? `${v.current.title} · ` : ''}
                  {v.steps.done}/{v.steps.total} bước · {timeOf(v.updated_at)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {ideas && ideas.length > 0 && (
        <section>
          <h4>💡 Gợi ý nội dung từ đối thủ</h4>
          {ideas.map((x) => (
            <div key={x.channel.path} className="home-ideas" data-testid="home-ideas">
              <div className="muted">{x.channel.name}</div>
              {x.pending && <p className="muted">⏳ {x.pending}</p>}
              {x.error && <p className="muted">{x.error}</p>}
              <div className="home-cards">
                {x.items.map((it) => (
                  <div key={it.id} className="home-card" data-testid="home-idea">
                    <b>{it.title}</b>
                    <span className="muted">{it.angle}</span>
                    {it.source.source_channel && (
                      <span className="muted">Nguồn: {it.source.source_channel.title}</span>
                    )}
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() => void create(x, it)}
                    >
                      {busy === it.id ? 'Đang tạo…' : 'Tạo video'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
      {ideas && ideas.length === 0 && (
        <p className="muted">
          Chưa kênh nào có thông tin đối thủ — thêm đối thủ trong Cài đặt kênh để nhận gợi ý nội
          dung.
        </p>
      )}
    </div>
  );
}
