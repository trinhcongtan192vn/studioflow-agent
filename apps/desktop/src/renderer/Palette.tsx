import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { paletteFilter, type PaletteItem } from './palette-format';

export interface Command extends PaletteItem {
  run: () => void;
}

/** 073: bảng lệnh Ctrl+K — nhảy tới video/trang, chạy thao tác nhanh. ↑↓ chọn, Enter chạy, Esc đóng. */
export function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const list = useMemo(() => paletteFilter(commands, q).slice(0, 50), [commands, q]);
  const box = useRef<HTMLUListElement>(null);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    box.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };
  let lastGroup = '';
  return (
    <div className="modal palette-backdrop" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Bảng lệnh"
        data-testid="palette"
        onClick={(e) => e.stopPropagation()}
      >
        <label className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            placeholder="Tìm video, trang hoặc thao tác…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((i) => Math.min(i + 1, list.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') run(list[sel]);
              else if (e.key === 'Escape') onClose();
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <ul className="palette-list" role="listbox" ref={box}>
          {list.map((c, i) => {
            const head = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {head && <div className="palette-group">{c.group}</div>}
                <button
                  role="option"
                  aria-selected={i === sel}
                  className={i === sel ? 'active' : ''}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(c)}
                >
                  <span>{c.label}</span>
                  {c.hint && <span className="muted">{c.hint}</span>}
                </button>
              </li>
            );
          })}
          {!list.length && <li className="muted palette-empty">Không có kết quả.</li>}
        </ul>
      </div>
    </div>
  );
}
