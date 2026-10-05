import { useState, type ReactNode } from 'react';
import { AudioPlayer } from './AudioPlayer';
import { Markdown } from './ChatParts';
import { labelOf, parseDoc, showValue, type DocBlock } from './doc-format';

/** URL đọc-only qua giao thức `sf-media:` (main chỉ cho video render, ảnh, audio xem trước). */
export const mediaUrl = (abs: string) => `sf-media:///${encodeURI(abs.replace(/\\/g, '/'))}`;

const TAG_TITLE: Record<string, string> = {
  'sf-scene': 'Cảnh',
  'sf-frame': 'Khung hình',
  'sf-cast': 'Nhân vật',
  'sf-story': 'Đoạn truyện',
};
/** Khóa kỹ thuật không cần hiện trong thẻ. */
const HIDDEN = new Set(['schema_version', 'generated_from']);

function KeyValues({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k]) => !HIDDEN.has(k) && k !== 'layers');
  return (
    <dl className="kv">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{labelOf(k)}</dt>
          <dd>{showValue(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Layers({ layers }: { layers: unknown }) {
  if (!Array.isArray(layers) || !layers.length) return null;
  return (
    <ul className="layers">
      {layers.map((l, i) => {
        const o = (l ?? {}) as Record<string, unknown>;
        const req = o.asset_request as { prompt?: string; source?: string } | undefined;
        return (
          <li key={i}>
            <span className="badge">{String(o.kind ?? 'lớp')}</span>{' '}
            {typeof o.text === 'string'
              ? `“${o.text}”`
              : req?.prompt
                ? `${req.source === 'generate' ? 'Sinh ảnh' : 'Tìm ảnh'}: ${req.prompt}`
                : typeof o.asset_id === 'string'
                  ? `ảnh ${o.asset_id}`
                  : ''}
          </li>
        );
      })}
    </ul>
  );
}

function DataCard({ tag, data }: { tag: string; data: unknown }) {
  const title = TAG_TITLE[tag] ?? tag;
  if (typeof data !== 'object' || data === null)
    return (
      <div className="doc-card raw">
        <div className="doc-card-head">{title} · không đọc được</div>
        <pre>{String(data)}</pre>
      </div>
    );
  const list = Array.isArray(data) ? data : [data];
  return (
    <>
      {list.map((d, i) => {
        const o = (d ?? {}) as Record<string, unknown>;
        return (
          <div key={i} className={`doc-card ${tag}`}>
            <div className="doc-card-head">
              {title}
              {typeof o.title === 'string' || typeof o.name === 'string' ? (
                <b> · {String(o.title ?? o.name)}</b>
              ) : null}
              {typeof o.id === 'string' && <span className="muted"> {o.id}</span>}
            </div>
            {typeof o.intent === 'string' && <p className="intent">{o.intent}</p>}
            <KeyValues
              data={Object.fromEntries(
                Object.entries(o).filter(([k]) => !['id', 'title', 'name', 'intent'].includes(k)),
              )}
            />
            <Layers layers={o.layers} />
          </div>
        );
      })}
    </>
  );
}

function Block({ b }: { b: DocBlock }): ReactNode {
  switch (b.kind) {
    case 'heading': {
      const H = `h${Math.min(b.level + 1, 6)}` as 'h3';
      return <H className={b.beat ? 'beat' : undefined}>{b.text}</H>;
    }
    case 'line':
      return (
        <div className="script-line">
          <div className="script-meta">
            <span className={`speaker${b.speaker === 'narrator' ? ' narrator' : ''}`}>
              {b.speaker === 'narrator' ? 'Người dẫn' : b.speaker}
            </span>
            {b.emotion && <span className="badge">{b.emotion}</span>}
            {b.direction && <i className="muted">({b.direction})</i>}
            {b.pause !== undefined && <span className="muted">· nghỉ {b.pause} ms</span>}
          </div>
          <div className="script-text">{b.text}</div>
          {b.tts && <div className="muted tts">Đọc là: {b.tts}</div>}
        </div>
      );
    case 'data':
      return <DataCard tag={b.tag} data={b.data} />;
    case 'code':
      return <pre>{b.text}</pre>;
    default:
      return <Markdown text={b.text} />;
  }
}

/** Tài liệu Markdown của dự án hiển thị dạng đọc (front matter thành chip, khối `sf-*` thành thẻ). */
export function DocView({ text }: { text: string }) {
  const doc = parseDoc(text);
  const front = doc.front.filter(([k]) => !HIDDEN.has(k));
  return (
    <div className="doc">
      {front.length > 0 && (
        <div className="doc-front">
          {front.map(([k, v]) => (
            <span key={k} className="chip">
              <span className="muted">{labelOf(k)}:</span> {showValue(k, v)}
            </span>
          ))}
        </div>
      )}
      {doc.blocks.map((b, i) => (
        <Block key={i} b={b} />
      ))}
    </div>
  );
}

export interface ViewedFile {
  /** Đường dẫn tương đối trong kênh. */
  path: string;
  kind: string;
  content?: string;
  size: number;
}

/** Hộp xem tệp chỉ đọc (explorer + nút CTA trong chat). */
export function FileViewer({
  channel,
  file,
  onClose,
}: {
  channel: string;
  file: ViewedFile;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(false);
  const isMd = /\.md$/i.test(file.path);
  const abs = `${channel}/${file.path}`;
  let body: ReactNode;
  if (/\.mp4$/i.test(file.path))
    body = <video className="viewer-media" controls src={mediaUrl(abs)} />;
  else if (/\.(wav|mp3|m4a|ogg|flac)$/i.test(file.path))
    body = <AudioPlayer src={abs} label={file.path} />;
  else if (/\.(png|jpe?g|webp)$/i.test(file.path))
    body = <img className="viewer-media" alt={file.path} src={mediaUrl(abs)} />;
  else if (file.kind === 'binary')
    body = <p className="muted">Tệp nhị phân, {file.size.toLocaleString('vi-VN')} byte.</p>;
  else if (isMd && !raw) body = <DocView text={file.content ?? ''} />;
  else {
    let txt = file.content ?? '';
    if (file.kind === 'json')
      try {
        txt = JSON.stringify(JSON.parse(txt), null, 2);
      } catch {
        /* giữ nguyên */
      }
    body = <pre>{txt}</pre>;
  }
  return (
    <div className="modal" onClick={onClose}>
      <div className="card wide viewer" onClick={(e) => e.stopPropagation()}>
        <div className="row viewer-head">
          <b title={file.path}>{file.path.split('/').pop()}</b>
          <span className="muted viewer-path">{file.path}</span>
          {isMd && (
            <button className="link" onClick={() => setRaw(!raw)}>
              {raw ? 'Xem dạng đọc' : 'Xem dạng gốc'}
            </button>
          )}
          <button onClick={onClose}>Đóng</button>
        </div>
        <div className="viewer-body" data-testid="file-content">
          {body}
        </div>
      </div>
    </div>
  );
}
