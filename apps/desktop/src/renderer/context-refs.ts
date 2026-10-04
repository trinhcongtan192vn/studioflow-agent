/**
 * Ngữ cảnh chat chọn trong xem trước (FR-CH-04, D5 mục 1 `ContextRef`, 028): kho dùng chung giữa
 * Xem trước / bảng caption (thêm) và Chat (chip, gửi kèm `context_refs`).
 */
export interface ContextRef {
  kind: 'frame' | 'time' | 'element' | 'caption_group';
  id?: string;
  time_ms?: number;
}

type Listener = (refs: ContextRef[]) => void;
let refs: ContextRef[] = [];
const listeners = new Set<Listener>();

const same = (a: ContextRef, b: ContextRef) =>
  a.kind === b.kind && a.id === b.id && a.time_ms === b.time_ms;

export function addContextRef(r: ContextRef): void {
  if (refs.some((x) => same(x, r))) return;
  refs = [...refs, r];
  listeners.forEach((l) => l(refs));
}

export function removeContextRef(r: ContextRef): void {
  refs = refs.filter((x) => !same(x, r));
  listeners.forEach((l) => l(refs));
}

export function clearContextRefs(): void {
  refs = [];
  listeners.forEach((l) => l(refs));
}

export function onContextRefs(l: Listener): () => void {
  listeners.add(l);
  l(refs);
  return () => listeners.delete(l);
}

/** Nhãn chip tiếng Việt. */
export function contextLabel(r: ContextRef): string {
  const t = r.time_ms !== undefined ? `${(r.time_ms / 1000).toFixed(2)} s` : '';
  switch (r.kind) {
    case 'time':
      return `Mốc ${t}`;
    case 'frame':
      return `Frame ${r.id ?? ''}${t ? ` @ ${t}` : ''}`;
    case 'element':
      return `Phần tử ${r.id ?? ''}`;
    case 'caption_group':
      return `Cụm phụ đề ${r.id ?? ''}`;
  }
}
