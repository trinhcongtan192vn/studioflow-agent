import { useEffect, useRef, useState } from 'react';
import type { ChatLine, IpcEvents } from '@studioflow/core';
import { core } from './rpc';
import {
  activityLabel,
  changedSteps,
  fileCtaLabel,
  friendlyStepError,
  groupRuns,
  stepCtas,
  voiceSuggestion,
  type StepCta,
  type VoiceSuggestion,
} from './chat-format';
import { mediaUrl } from './FileViewer';
import { Markdown, ToolGroup } from './ChatParts';
import {
  clearContextRefs,
  contextLabel,
  onContextRefs,
  removeContextRef,
  type ContextRef,
} from './context-refs';

type Item =
  | { type: 'line'; line: ChatLine }
  | { type: 'approval'; card: IpcEvents['approval.requested']; done?: string }
  | { type: 'permission'; card: IpcEvents['permission.requested']; done?: string }
  | {
      type: 'step';
      step: { id: string; title: string; status: string };
      ctas: StepCta[];
      error?: string;
      done?: string;
    }
  | { type: 'voice'; voice: VoiceSuggestion; done?: string };

type ApprovalCard = IpcEvents['approval.requested'];

type StepFile = { status: string; outputs?: string[]; error?: { message: string } };
type StateFile = {
  steps?: Record<string, StepFile>;
  approvals?: {
    id: string;
    step_id: string;
    status: string;
    note?: string;
    artifact_hashes: Record<string, string>;
  }[];
};

/** Khu chat (FR-CH-02/03/07): luồng trả lời, tool, job; thẻ duyệt/xác nhận; đính kèm. */
export function Chat({
  channel,
  video,
  onOpenFile,
  onOpenTab,
}: {
  channel: string;
  video?: string;
  /** Mở tệp (đường dẫn tương đối trong video) ở hộp xem tệp. */
  onOpenFile?: (rel: string) => void;
  /** Chuyển tab bên phải ("Xem trước", "Nhạc"…). */
  onOpenTab?: (tab: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  // agent đang làm gì (chỉ báo "…" cuối khung chat); null = không xử lý
  const [activity, setActivity] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ path: string; mime: string }[]>([]);
  // FR-CH-04 (028): ngữ cảnh chọn trong Xem trước / bảng caption
  const [refs, setRefs] = useState<ContextRef[]>([]);
  useEffect(() => onContextRefs(setRefs), []);
  useEffect(() => clearContextRefs, [channel, video]);
  const [note, setNote] = useState('');
  // thẻ duyệt đang chờ: ghim ở đáy khung chat (không trôi theo tin nhắn), đồng bộ theo state.json
  const [pending, setPending] = useState<ApprovalCard[]>([]);
  const end = useRef<HTMLDivElement>(null);
  // trạng thái bước lần trước: phát hiện bước vừa xong/lỗi để hiện thẻ CTA
  const prevSteps = useRef<Record<string, string>>({});

  useEffect(() => {
    void core
      .call('chat.history', { channel, ...(video ? { video } : {}) })
      .then((h) =>
        setItems((s) => [...h.history.map((line): Item => ({ type: 'line', line })), ...s]),
      );
    const add = (i: Item) =>
      setItems((s) =>
        i.type === 'approval' &&
        s.some((x) => x.type === 'approval' && x.card.approval_id === i.card.approval_id)
          ? s
          : [...s, i],
      );
    /** Thẻ bước (xong/lỗi) với CTA theo tệp kết quả + lỗi trong state.json. */
    const stepCards = (steps: { id: string; title: string; status: string }[]) =>
      void readState().then((st) =>
        steps.forEach((step) => {
          const err = st?.steps?.[step.id]?.error?.message;
          add({
            type: 'step',
            step,
            ctas: stepCtas(step, st?.steps?.[step.id]?.outputs, err),
            ...(step.status === 'failed' && err ? { error: err } : {}),
          });
        }),
      );
    const offs = [
      core.on('chat.event', (e) => {
        if (e.channel !== channel || (e.video ?? undefined) !== video) return;
        if (e.type === 'text_delta') {
          setStreaming((s) => s + e.text);
          setActivity(activityLabel({ kind: 'writing' }));
        } else if (e.type === 'tool_call') {
          setActivity(activityLabel({ kind: 'tool', name: e.name, input: e.input }));
          setStreaming((s) => {
            if (s) add({ type: 'line', line: { ts: '', role: 'assistant', content: s } });
            return '';
          });
          add({
            type: 'line',
            line: { ts: '', role: 'tool', content: '…', tool: { name: e.name, input: e.input } },
          });
        } else if (e.type === 'tool_result') {
          setActivity(activityLabel({ kind: 'thinking' }));
          setItems((s) => {
            const idx = s
              .map((x) => x.type === 'line' && x.line.role === 'tool' && x.line.content === '…')
              .lastIndexOf(true);
            if (idx < 0) return s;
            const copy = [...s];
            const it = copy[idx] as { type: 'line'; line: ChatLine };
            copy[idx] = { type: 'line', line: { ...it.line, content: e.summary } };
            return copy;
          });
        } else if (e.type === 'done' || e.type === 'error') {
          setActivity(null);
          setStreaming((s) => {
            if (s) add({ type: 'line', line: { ts: '', role: 'assistant', content: s } });
            return '';
          });
          if (e.type === 'error')
            add({
              type: 'line',
              line: { ts: '', role: 'system', content: `${e.code}: ${e.message}` },
            });
        }
      }),
      core.on('approval.requested', (card) => {
        if (card.channel !== channel || card.video !== video) return;
        add({ type: 'approval', card });
        setPending((p) => (p.some((x) => x.approval_id === card.approval_id) ? p : [...p, card]));
      }),
      core.on('permission.requested', (card) => add({ type: 'permission', card })),
      // 033: giọng gợi ý xong → thẻ nghe thử + chọn
      core.on('job.updated', (j) => {
        if ((j.video_id ?? undefined) !== video) return;
        const v = voiceSuggestion(j);
        if (v)
          setItems((s) =>
            s.some((x) => x.type === 'voice' && x.voice.voice_id === v.voice_id)
              ? s
              : [...s, { type: 'voice', voice: v }],
          );
      }),
      core.on('workflow.updated', (s) => {
        if (s.channel !== channel || s.video_id !== video) return;
        const changed = changedSteps(prevSteps.current, s.steps);
        prevSteps.current = Object.fromEntries(s.steps.map((x) => [x.id, x.status]));
        void syncApprovals(s.steps);
        if (changed.length) stepCards(changed);
      }),
    ];
    if (video) {
      // mốc ban đầu + thẻ duyệt còn chờ (mở lại video sau khi agent đã xin duyệt)
      void core.call('workflow.state', { channel, video }).then(
        (s) => {
          prevSteps.current = Object.fromEntries(s.steps.map((x) => [x.id, x.status]));
          void syncApprovals(s.steps);
          // bước đang lỗi khi mở video → hiện lại thẻ lỗi (có nút sửa/chạy lại)
          const failed = s.steps.filter((x) => x.status === 'failed');
          if (failed.length) stepCards(failed);
        },
        () => {},
      );
    }
    return () => offs.forEach((o) => o());
  }, [channel, video]);

  /** Thẻ duyệt ghim = đúng các approval `pending` trong state.json (cũng bắt approval mất hiệu lực do file đổi). */
  async function syncApprovals(steps: { id: string; title: string }[]): Promise<void> {
    if (!video) return;
    const st = await readState();
    if (!st) return;
    const cards: ApprovalCard[] = (st.approvals ?? [])
      .filter((a) => a.status === 'pending')
      .map((a) => ({
        channel,
        video,
        approval_id: a.id,
        step_id: a.step_id,
        title:
          a.step_id === 'brief'
            ? 'Brief'
            : (steps.find((x) => x.id === a.step_id)?.title ?? a.step_id),
        ...(a.note ? { note: a.note } : {}),
        files: Object.keys(a.artifact_hashes),
      }));
    // mỗi bước chỉ một thẻ: approval mới nhất (cũ còn pending khi file đổi sau duyệt)
    setPending([...new Map(cards.map((c) => [c.step_id, c])).values()]);
    // duyệt ở nơi khác (tab Tiến độ…) → đánh dấu mốc trong luồng chat
    const open = new Set(cards.map((c) => c.approval_id));
    setItems((s) =>
      s.map((x) =>
        x.type === 'approval' && !x.done && !open.has(x.card.approval_id)
          ? { ...x, done: 'Đã xử lý' }
          : x,
      ),
    );
  }

  async function readState(): Promise<StateFile | undefined> {
    if (!video) return undefined;
    try {
      const r = await core.call('explorer.read', { channel, path: `videos/${video}/state.json` });
      return JSON.parse(r.content ?? 'null') as StateFile;
    } catch {
      return undefined;
    }
  }
  const runCta = async (i: number, c: StepCta) => {
    if (c.kind === 'file') onOpenFile?.(c.path);
    else if (c.kind === 'tab') onOpenTab?.(c.tab);
    else if (c.kind === 'say') void send(c.text);
    else if (c.kind === 'voice') {
      // FR-VO-01: chọn file mẫu → đính kèm + soạn sẵn lời nhờ agent; người dùng bấm Gửi
      if (await attach()) setDraft(c.prompt);
    } else if (video) {
      setItems((s) =>
        s.map((x, k) =>
          k === i ? { ...(x as Item & { type: 'step' }), done: 'Đang chạy lại…' } : x,
        ),
      );
      try {
        await core.call('workflow.run_step', { channel, video, step_id: c.step });
      } catch (e) {
        setItems((s) => [
          ...s,
          { type: 'line', line: { ts: '', role: 'system', content: (e as Error).message } },
        ]);
      }
    }
  };

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [items, streaming, activity]);

  const send = async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || busy) return;
    setItems((s) => [...s, { type: 'line', line: { ts: '', role: 'user', content: text } }]);
    if (override === undefined) setDraft('');
    setBusy(true);
    setActivity(activityLabel({ kind: 'thinking' }));
    try {
      await core.call('chat.send', {
        channel,
        ...(video ? { video } : {}),
        text,
        ...(attachments.length ? { attachments } : {}),
        ...(refs.length ? { context_refs: refs } : {}),
      });
    } catch (e) {
      setItems((s) => [
        ...s,
        { type: 'line', line: { ts: '', role: 'system', content: (e as Error).message } },
      ]);
    } finally {
      setAttachments([]);
      clearContextRefs();
      setBusy(false);
      setActivity(null);
    }
  };
  /** Chọn và nạp file đính kèm; trả số file nạp được. */
  const attach = async (): Promise<number> => {
    let n = 0;
    for (const p of await window.studioflow.pickFiles()) {
      try {
        const r = await core.call('upload.ingest', {
          channel,
          ...(video ? { video } : {}),
          path_on_disk: p,
        });
        setAttachments((s) => [...s, { path: r.rel_path, mime: r.mime }]);
        n++;
      } catch (e) {
        window.alert((e as Error).message);
      }
    }
    return n;
  };
  const [deciding, setDeciding] = useState(false);
  const decide = async (card: ApprovalCard, decision: 'approve' | 'changes_requested') => {
    setDeciding(true);
    try {
      await core.call('approval.decide', {
        channel,
        video: card.video,
        approval_id: card.approval_id,
        decision,
        ...(decision === 'changes_requested' ? { note } : {}),
      });
    } catch (e) {
      setItems((s) => [
        ...s,
        { type: 'line', line: { ts: '', role: 'system', content: (e as Error).message } },
      ]);
      return;
    } finally {
      setDeciding(false);
    }
    const done = decision === 'approve' ? 'Đã duyệt' : `Đã yêu cầu sửa: ${note}`;
    setPending((p) => p.filter((x) => x.approval_id !== card.approval_id));
    setItems((s) =>
      s.some((x) => x.type === 'approval' && x.card.approval_id === card.approval_id)
        ? s.map((x) =>
            x.type === 'approval' && x.card.approval_id === card.approval_id ? { ...x, done } : x,
          )
        : [...s, { type: 'approval', card, done }],
    );
    setNote('');
  };
  const permit = async (
    i: number,
    card: IpcEvents['permission.requested'],
    allow: boolean,
    remember = false,
  ) => {
    await core.call('permission.decide', {
      request_id: card.request_id,
      allow,
      ...(remember ? { remember } : {}),
    });
    setItems((s) =>
      s.map((x, k) =>
        k === i
          ? { ...(x as Item & { type: 'permission' }), done: allow ? 'Đã đồng ý' : 'Đã từ chối' }
          : x,
      ),
    );
  };

  return (
    <div className="chat">
      <div className="messages" data-testid="messages">
        {groupRuns(items, (x) => x.type === 'line' && x.line.role === 'tool').map((g) => {
          if (g.kind === 'tools')
            return (
              <ToolGroup
                key={g.items[0]!.index}
                lines={g.items.map((x) => (x.item as Item & { type: 'line' }).line)}
              />
            );
          const { item: it, index: i } = g;
          return it.type === 'line' ? (
            <div key={i} className={`msg ${it.line.role}`}>
              {it.line.role === 'assistant' ? (
                <Markdown text={it.line.content} />
              ) : (
                <span className="text">{it.line.content}</span>
              )}
            </div>
          ) : it.type === 'approval' ? (
            <div
              key={i}
              className={`approval-mark${it.done ? ' done' : ''}`}
              data-testid="approval-mark"
            >
              {it.done ? '✓' : '⏸'} {it.done ? `${it.done}` : 'Chờ bạn duyệt'}:{' '}
              <b>{it.card.title}</b>
              {!it.done && <span className="muted"> — thẻ duyệt ở cuối khung chat ↓</span>}
            </div>
          ) : it.type === 'voice' ? (
            <div key={i} className="card voice-card" data-testid="voice-card">
              <div className="voice-head">
                <b>🎙 {it.voice.name}</b>
                {it.voice.forLabel && <span className="muted"> · cho {it.voice.forLabel}</span>}
              </div>
              <div className="chips">
                {it.voice.traits.map((t) => (
                  <span key={t} className="badge">
                    {t}
                  </span>
                ))}
              </div>
              <audio controls preload="metadata" src={mediaUrl(`${channel}/${it.voice.preview}`)} />
              {it.done ? (
                <i>{it.done}</i>
              ) : (
                <div className="cta-row">
                  <button
                    className="cta primary"
                    disabled={busy}
                    onClick={() => {
                      setItems((s) =>
                        s.map((x, k) =>
                          k === i ? { ...(x as Item & { type: 'voice' }), done: 'Đã chọn' } : x,
                        ),
                      );
                      void send(it.voice.pick);
                    }}
                  >
                    Chọn giọng này
                  </button>
                </div>
              )}
            </div>
          ) : it.type === 'step' ? (
            <div key={i} className={`card step-card ${it.step.status}`} data-testid="step-card">
              <b>
                {it.step.status === 'failed' ? '✗ Lỗi ở bước' : '✓ Xong bước'}: {it.step.title}
              </b>
              {it.error && (
                <div className="error" title={it.error}>
                  {friendlyStepError(it.error)}
                </div>
              )}
              {it.done ? (
                <i>{it.done}</i>
              ) : (
                it.ctas.length > 0 && (
                  <div className="cta-row">
                    {it.ctas.map((c) => (
                      <button
                        key={c.label}
                        className={`cta${c.kind === 'retry' ? ' primary' : ''}`}
                        onClick={() => void runCta(i, c)}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>
          ) : (
            <div key={i} className="card permission">
              <b>Xác nhận: {it.card.summary}</b>
              {it.card.estimate !== undefined && (
                <pre className="note">{JSON.stringify(it.card.estimate)}</pre>
              )}
              {it.done ? (
                <i>{it.done}</i>
              ) : (
                <div className="row">
                  <button onClick={() => void permit(i, it.card, true)}>Đồng ý</button>
                  <button onClick={() => void permit(i, it.card, false)}>Từ chối</button>
                  <button onClick={() => void permit(i, it.card, true, true)}>
                    Luôn cho phép trong video này
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {streaming && (
          <div className="msg assistant streaming" data-testid="streaming">
            <Markdown text={streaming} />
          </div>
        )}
        {activity && (
          <div className="activity" data-testid="activity" role="status" aria-live="polite">
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="activity-text">{activity}</span>
          </div>
        )}
        <div ref={end} />
      </div>
      {pending.length > 0 && (
        <div className="approval-dock" data-testid="approval-dock">
          {pending.map((card) => (
            <div key={card.approval_id} className="card approval" data-testid="approval-card">
              <div className="approval-head">
                <span className="badge warn">Chờ bạn duyệt</span> <b>{card.title}</b>
              </div>
              {card.note && <div className="note">{card.note}</div>}
              <div className="cta-row">
                {card.files.map((f) => (
                  <button key={f} className="cta" onClick={() => onOpenFile?.(f)}>
                    {fileCtaLabel(f) ?? `Xem ${f}`}
                  </button>
                ))}
              </div>
              <div className="row approval-actions">
                <button
                  className="primary"
                  disabled={deciding}
                  onClick={() => void decide(card, 'approve')}
                >
                  Duyệt
                </button>
                <input
                  placeholder="Hoặc ghi điều cần sửa…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && note.trim()) void decide(card, 'changes_requested');
                  }}
                />
                <button
                  disabled={deciding || !note.trim()}
                  onClick={() => void decide(card, 'changes_requested')}
                >
                  Yêu cầu sửa
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="composer">
        {refs.length > 0 && (
          <div className="chips" data-testid="context-chips">
            {refs.map((r) => (
              <span key={contextLabel(r)} className="chip">
                {contextLabel(r)}{' '}
                <button className="link" title="Bỏ" onClick={() => removeContextRef(r)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="chips">
            {attachments.map((a) => (
              <span key={a.path} className="chip">
                {a.path}
              </span>
            ))}
          </div>
        )}
        <textarea
          data-testid="chat-input"
          placeholder="Nhắn cho agent… (Ctrl+Enter để gửi, Esc để dừng)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) void send();
            if (e.key === 'Escape')
              void core.call('chat.interrupt', { channel, ...(video ? { video } : {}) });
          }}
        />
        <div className="row">
          <button onClick={() => void attach()} title="Đính kèm">
            📎
          </button>
          <button
            data-testid="chat-send"
            disabled={busy || !draft.trim()}
            onClick={() => void send()}
          >
            {busy ? 'Đang trả lời…' : 'Gửi'}
          </button>
        </div>
      </div>
    </div>
  );
}
