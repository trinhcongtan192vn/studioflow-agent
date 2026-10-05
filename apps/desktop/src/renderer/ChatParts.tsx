import { useState, type ReactNode } from 'react';
import type { ChatLine } from '@studioflow/core';
import {
  isQuietTool,
  parseInline,
  parseMarkdown,
  toolLabel,
  toolOutcome,
  toolTarget,
} from './chat-format';

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) =>
        s.kind === 'b' ? (
          <strong key={i}>{s.text}</strong>
        ) : s.kind === 'i' ? (
          <em key={i}>{s.text}</em>
        ) : s.kind === 'code' ? (
          <code key={i}>{s.text}</code>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** Câu trả lời của agent dạng Markdown tối giản (đoạn, tiêu đề, danh sách, code). */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parseMarkdown(text).map((b, i): ReactNode => {
        if (b.kind === 'code') return <pre key={i}>{b.text}</pre>;
        if (b.kind === 'h')
          return (
            <h4 key={i}>
              <Inline text={b.text} />
            </h4>
          );
        if (b.kind === 'ul' || b.kind === 'ol') {
          const L = b.kind;
          return (
            <L key={i}>
              {b.items.map((it, k) => (
                <li key={k}>
                  <Inline text={it} />
                </li>
              ))}
            </L>
          );
        }
        return (
          <p key={i}>
            {(b as { text: string }).text.split('\n').map((ln: string, k: number) => (
              <span key={k}>
                {k > 0 && <br />}
                <Inline text={ln} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const ICON = { running: '⏳', ok: '✓', error: '✗' } as const;

function ToolRow({ line }: { line: ChatLine }) {
  const [open, setOpen] = useState(false);
  const name = line.tool?.name ?? '';
  const out = toolOutcome(line.content);
  const target = toolTarget(line.tool?.input);
  const quiet = isQuietTool(name);
  return (
    <div className={`tool-row ${out.status}${quiet ? ' quiet' : ''}`}>
      <button className="tool-head" onClick={() => setOpen(!open)} title="Xem chi tiết">
        <span className={`tool-icon ${out.status}`}>{ICON[out.status]}</span>
        <span className="tool-name">{toolLabel(name)}</span>
        {target && <span className="tool-target">{target}</span>}
        {out.status === 'error' && <span className="tool-error">{out.message}</span>}
      </button>
      {open && (
        <div className="tool-detail">
          <div className="muted">Đầu vào</div>
          <pre>{JSON.stringify(line.tool?.input ?? {}, null, 2)}</pre>
          {out.detail && (
            <>
              <div className="muted">Kết quả</div>
              <pre>{out.detail}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Chuỗi thao tác liền nhau của agent: một khối gọn, mở ra xem từng thao tác. */
export function ToolGroup({ lines }: { lines: ChatLine[] }) {
  const outs = lines.map((l) => toolOutcome(l.content).status);
  const running = outs.includes('running');
  const errors = outs.filter((s) => s === 'error').length;
  const [open, setOpen] = useState(false);
  const show = open || running || errors > 0;
  const visible = lines.filter((l) => !isQuietTool(l.tool?.name ?? ''));
  return (
    <div className="tool-group" data-testid="tool-group">
      <button className="tool-group-head" onClick={() => setOpen(!open)}>
        <span>{running ? '⏳' : errors ? '⚠' : '✓'}</span>
        <span>
          {visible.length || lines.length} thao tác
          {errors ? ` · ${errors} lỗi` : ''}
          {running ? ' · đang chạy' : ''}
        </span>
        {!show && (
          <span className="muted tool-group-peek">
            {[...new Set(visible.map((l) => toolLabel(l.tool?.name ?? '')))]
              .slice(0, 4)
              .join(' · ')}
          </span>
        )}
        <span className="chev">{show ? '▾' : '▸'}</span>
      </button>
      {show && (
        <div className="tool-list">
          {(open ? lines : lines.filter((l) => !isQuietTool(l.tool?.name ?? ''))).map((l, i) => (
            <ToolRow key={i} line={l} />
          ))}
        </div>
      )}
    </div>
  );
}
