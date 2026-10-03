import type { ProviderManifest, RelPath } from '../contracts/types.js';
import type { Logger } from '../log.js';

/** Span trace (OpenTelemetry) — kiểu cụ thể gắn ở 015; tới lúc đó là đối tượng rỗng. */
export type Span = { setAttribute?(key: string, value: unknown): void; end?(): void };

/** D4 mục 4.2 — giữ đúng hình dạng của spec. */
export interface RunContext {
  signal: AbortSignal;
  /** Thư mục tạm riêng cho lần chạy (ngoài project); đầu ra được module ghi đưa vào project. */
  workdir: string;
  progress(done: number, total: number, message?: string): void;
  logger: Logger;
  span: Span;
  /** Đường dẫn tuyệt đối để đọc một file trong kênh/video. */
  resolveInput(path: RelPath): string;
  secrets: (name: string) => Promise<string>;
}

export interface ProviderAdapter<I, O> {
  manifest: ProviderManifest;
  health(): Promise<{ ok: boolean; detail?: string }>;
  prepare?(): Promise<void>;
  run(input: I, ctx: RunContext): Promise<O>;
  release?(mode: 'offload' | 'unload'): Promise<void>;
  cacheKeyParts(input: I): unknown;
  /** Hash file model (nếu provider dùng model cục bộ) — thành phần khóa cache (D4 mục 7). */
  modelFileHash?: string | null;
}
