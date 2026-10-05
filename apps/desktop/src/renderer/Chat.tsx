import { useEffect, useRef, useState } from 'react';
import type { ChatLine, IpcEvents } from '@studioflow/core';
import { core } from './rpc';
import { groupRuns } from './chat-format';
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
  | { type: 'permission'; card: IpcEvents['permission.requested']; done?: string };

/** Khu chat (FR-CH-02/03/07): luồng trả lời, tool, job; thẻ duyệt/xác nhận; đính kèm. */
export function Chat({ channel, video }: { channel: string; video?: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<{ path: string; mime: string }[]>([]);
  // FR-CH-04 (028): ngữ cảnh chọn trong Xem trước / bảng caption
  const [refs, setRefs] = useState<ContextRef[]>([]);
  useEffect(() => onContextRefs(setRefs), []);
  useEffect(() => clearContextRefs, [channel, video]);
  const [note, setNote] = useState('');
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void core
      .call('chat.history', { channel, ...(video ? { video } : {}) })
      .then((h) => setItems(h.history.map((line) => ({ type: 'line', line }))));
    const add = (i: Item) => setItems((s) => [...s, i]);
    const offs = [
      core.on('chat.event', (e) => {
        if (e.channel !== channel || (e.video ?? undefined) !== video) return;
        if (e.type === 'text_delta') setStreaming((s) => s + e.text);
        else if (e.type === 'tool_call') {
          setStreaming((s) => {
            if (s) add({ type: 'line', line: { ts: '', role: 'assistant', content: s } });
            return '';
          });
          add({
            type: 'line',
            line: { ts: '', role: 'tool', content: '…', tool: { name: e.name, input: e.input } },
          });
        } else if (e.type === 'tool_result') {
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
        if (card.channel === channel && card.video === video) add({ type: 'approval', card });
      }),
      core.on('permission.requested', (card) => add({ type: 'permission', card })),
    ];
    return () => offs.forEach((o) => o());
  }, [channel, video]);

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [items, streaming]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setItems((s) => [...s, { type: 'line', line: { ts: '', role: 'user', content: text } }]);
    setDraft('');
    setBusy(true);
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
    }
  };
  const attach = async () => {
    for (const p of await window.studioflow.pickFiles()) {
      try {
        const r = await core.call('upload.ingest', {
          channel,
          ...(video ? { video } : {}),
          path_on_disk: p,
        });
        setAttachments((s) => [...s, { path: r.rel_path, mime: r.mime }]);
      } catch (e) {
        window.alert((e as Error).message);
      }
    }
  };
  const decide = async (
    i: number,
    card: IpcEvents['approval.requested'],
    decision: 'approve' | 'changes_requested',
  ) => {
    await core.call('approval.decide', {
      channel,
      video: card.video,
      approval_id: card.approval_id,
      decision,
      ...(decision === 'changes_requested' ? { note } : {}),
    });
    setItems((s) =>
      s.map((x, k) =>
        k === i
          ? {
              ...(x as Item & { type: 'approval' }),
              done: decision === 'approve' ? 'Đã duyệt' : 'Đã yêu cầu sửa',
            }
          : x,
      ),
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
            <div key={i} className="card approval" data-testid="approval-card">
              <b>Duyệt: {it.card.title}</b>
              {it.card.note && <pre className="note">{it.card.note}</pre>}
              <div className="muted">{it.card.files.join(', ')}</div>
              {it.done ? (
                <i>{it.done}</i>
              ) : (
                <div className="row">
                  <button onClick={() => void decide(i, it.card, 'approve')}>Duyệt</button>
                  <input
                    placeholder="Ghi chú yêu cầu sửa"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button
                    disabled={!note.trim()}
                    onClick={() => void decide(i, it.card, 'changes_requested')}
                  >
                    Yêu cầu sửa
                  </button>
                </div>
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
        <div ref={end} />
      </div>
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
