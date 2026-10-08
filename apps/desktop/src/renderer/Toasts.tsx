import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import type { ToastTone } from './palette-format';

/** 073: thông báo nổi ở góc dưới phải — tự ẩn sau 8 s, có nút hành động (vd. "Mở video"). */
export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
  action?: { label: string; run: () => void };
}

type Listener = (t: Toast[]) => void;
let items: Toast[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(items));

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function toast(t: Omit<Toast, 'id'>): void {
  const id = ++seq;
  // tối đa 4 thông báo; cái cũ nhất ra trước
  items = [...items, { ...t, id }].slice(-4);
  emit();
  window.setTimeout(() => dismissToast(id), 8000);
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => void listeners.delete(setList);
  }, []);
  if (!list.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite" data-testid="toasts">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span className="toast-text">{t.text}</span>
          {t.action && (
            <button
              className="link"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            className="ghost icon-only"
            aria-label="Ẩn thông báo"
            onClick={() => dismissToast(t.id)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
