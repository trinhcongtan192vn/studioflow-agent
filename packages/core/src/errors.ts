/**
 * Lỗi có mã của core. `code` thuộc registry `docs/contracts/errors.json`; `details` tùy chọn
 * (ví dụ danh sách lỗi schema). CLI in `{code, message, details?}` ra stderr (D4 mục 12).
 */
export class SfError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
    /** Mã thoát khi lỗi tới CLI: 1 = nghiệp vụ, 2 = tham số. */
    readonly exit: 1 | 2 = 1,
  ) {
    super(message);
    this.name = 'SfError';
  }
}

export const isSfError = (e: unknown): e is SfError => e instanceof SfError;
