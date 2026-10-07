/** `fetch` tiêm được cho các bộ đăng bài (053/056): test không chạm mạng. Thân có thể là chuỗi, byte hoặc form. */
export type HttpFetch = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array | FormData;
  },
) => Promise<Response>;

export const realFetch: HttpFetch = (url, init) => fetch(url, init as RequestInit);

export const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Đọc thân phản hồi dạng JSON; không phải JSON → `undefined`. */
export async function jsonOf<T = Record<string, unknown>>(r: Response): Promise<T | undefined> {
  try {
    return (await r.json()) as T;
  } catch {
    return undefined;
  }
}
