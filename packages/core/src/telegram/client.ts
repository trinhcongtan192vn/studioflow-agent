/**
 * Bot API Telegram (055, FR-AP-11/12): client mỏng, `fetch` tiêm được (test không chạm mạng). Token nằm trong
 * URL nên KHÔNG BAO GIỜ đưa URL vào thông báo lỗi/log.
 */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string | FormData },
) => Promise<Response>;

export const TELEGRAM_LIMITS = {
  /** Số ký tự tối đa của một tin nhắn văn bản. */
  MESSAGE: 4096,
  /** Chờ `getUpdates` (giây). */
  POLL_TIMEOUT_S: 25,
} as const;

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}
export interface TgEntity {
  type: string;
  offset: number;
  length: number;
  user?: TgUser;
}
export interface TgMessage {
  message_id: number;
  date?: number;
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
  from?: TgUser;
  text?: string;
  entities?: TgEntity[];
  reply_to_message?: TgMessage;
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}
export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}
export type ParseMode = 'HTML' | 'MarkdownV2';

/** Lỗi Bot API: `network` (không tới được), `http` (HTTP không ok, không có JSON), `api` (ok:false). */
export class TelegramApiError extends Error {
  constructor(
    readonly kind: 'network' | 'http' | 'api',
    readonly method: string,
    message: string,
    readonly status?: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

/** Escape cho `parse_mode: HTML`. */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escape cho `parse_mode: MarkdownV2` (mọi ký tự đặc biệt của MarkdownV2 phải có `\` đứng trước). */
export const escapeMarkdownV2 = (s: string): string =>
  s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');

/**
 * Chia văn bản dài thành các đoạn ≤ `limit` ký tự, ưu tiên cắt ở xuống dòng (rồi khoảng trắng); dòng dài hơn
 * giới hạn mới cắt cứng. Mỗi đoạn không có khoảng trắng thừa ở đầu/cuối.
 */
export function splitMessage(text: string, limit: number = TELEGRAM_LIMITS.MESSAGE): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    let cut = window.lastIndexOf('\n');
    if (cut < limit / 2) {
      const sp = window.lastIndexOf(' ');
      if (sp > cut) cut = sp;
    }
    if (cut < limit / 4) cut = limit;
    out.push(rest.slice(0, cut).replace(/\s+$/, ''));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) out.push(rest);
  return out.filter((x) => x.length > 0);
}

interface Envelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export interface TelegramClientOptions {
  token: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Chờ giữa các lần thử lại (test thay bằng hàm không chờ). */
  sleep?: (ms: number) => Promise<void>;
  /** Số lần thử lại cho 429 và lỗi mạng ở lời gọi gửi (không áp cho getUpdates). */
  retries?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TelegramClient {
  private readonly f: FetchLike;
  private readonly base: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retries: number;

  constructor(private readonly o: TelegramClientOptions) {
    this.f = o.fetch ?? ((url, init) => fetch(url, init as RequestInit));
    this.base = o.baseUrl ?? 'https://api.telegram.org';
    this.sleep = o.sleep ?? realSleep;
    this.retries = o.retries ?? 3;
  }

  private async once<T>(method: string, params: object | FormData): Promise<T> {
    const url = `${this.base}/bot${this.o.token}/${method}`;
    const init =
      params instanceof FormData
        ? { method: 'POST', body: params }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(params),
          };
    let r: Response;
    try {
      r = await this.f(url, init);
    } catch {
      // không đưa nguyên nhân gốc: thông báo lỗi của fetch có thể chứa URL (token)
      throw new TelegramApiError('network', method, `telegram ${method}: network error`);
    }
    let body: Envelope<T> | undefined;
    try {
      body = (await r.json()) as Envelope<T>;
    } catch {
      /* không phải JSON */
    }
    if (body?.ok) return body.result as T;
    const status = body?.error_code ?? r.status;
    if (!body)
      throw new TelegramApiError('http', method, `telegram ${method}: HTTP ${r.status}`, r.status);
    throw new TelegramApiError(
      'api',
      method,
      `telegram ${method}: ${status} ${body.description ?? 'error'}`,
      status,
      body.parameters?.retry_after,
    );
  }

  /** Gọi có thử lại: 429 chờ `retry_after`, lỗi mạng/5xx chờ lũy tiến. */
  private async call<T>(method: string, params: object | FormData, retry = true): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(method, params);
      } catch (e) {
        const err = e as TelegramApiError;
        const transient =
          err.kind === 'network' ||
          err.status === 429 ||
          (err.status !== undefined && err.status >= 500);
        if (!retry || !transient || attempt >= this.retries) throw e;
        await this.sleep(err.retryAfter ? err.retryAfter * 1000 : 500 * 2 ** attempt);
      }
    }
  }

  getMe(): Promise<TgUser> {
    return this.call<TgUser>('getMe', {}, false);
  }

  /** Long polling; không thử lại ở đây (vòng lặp của bot tự lùi lại khi lỗi). */
  getUpdates(o: { offset?: number; timeout?: number } = {}): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>(
      'getUpdates',
      {
        ...(o.offset !== undefined ? { offset: o.offset } : {}),
        timeout: o.timeout ?? TELEGRAM_LIMITS.POLL_TIMEOUT_S,
        allowed_updates: ['message', 'callback_query'],
      },
      false,
    );
  }

  /** Gửi tin; văn bản dài được chia, bàn phím chỉ gắn vào đoạn cuối. Trả các tin đã gửi. */
  async sendMessage(
    chatId: string | number,
    text: string,
    o: {
      parse_mode?: ParseMode;
      reply_markup?: InlineKeyboard;
      reply_to_message_id?: number;
      disable_web_page_preview?: boolean;
    } = {},
  ): Promise<TgMessage[]> {
    const parts = splitMessage(text);
    const sent: TgMessage[] = [];
    for (const [i, part] of parts.entries()) {
      sent.push(
        await this.call<TgMessage>('sendMessage', {
          chat_id: chatId,
          text: part,
          ...(o.parse_mode ? { parse_mode: o.parse_mode } : {}),
          ...(o.reply_markup && i === parts.length - 1 ? { reply_markup: o.reply_markup } : {}),
          ...(o.reply_to_message_id && i === 0
            ? {
                reply_parameters: {
                  message_id: o.reply_to_message_id,
                  allow_sending_without_reply: true,
                },
              }
            : {}),
          disable_web_page_preview: o.disable_web_page_preview ?? true,
        }),
      );
    }
    return sent;
  }

  /** Gửi ảnh: URL/file_id (JSON) hoặc byte (multipart). Chú thích ≤ 1024 ký tự. */
  sendPhoto(
    chatId: string | number,
    photo: string | { bytes: Uint8Array; filename: string },
    o: { caption?: string; parse_mode?: ParseMode; reply_markup?: InlineKeyboard } = {},
  ): Promise<TgMessage> {
    const caption = o.caption?.slice(0, 1024);
    if (typeof photo === 'string')
      return this.call<TgMessage>('sendPhoto', {
        chat_id: chatId,
        photo,
        ...(caption ? { caption } : {}),
        ...(o.parse_mode ? { parse_mode: o.parse_mode } : {}),
        ...(o.reply_markup ? { reply_markup: o.reply_markup } : {}),
      });
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('photo', new Blob([photo.bytes as BlobPart]), photo.filename);
    if (caption) form.set('caption', caption);
    if (o.parse_mode) form.set('parse_mode', o.parse_mode);
    if (o.reply_markup) form.set('reply_markup', JSON.stringify(o.reply_markup));
    return this.call<TgMessage>('sendPhoto', form);
  }

  /** `markup` bỏ trống → gỡ bàn phím. */
  editMessageReplyMarkup(
    chatId: string | number,
    messageId: number,
    markup?: InlineKeyboard,
  ): Promise<unknown> {
    return this.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: markup ?? { inline_keyboard: [] },
    });
  }

  answerCallbackQuery(
    id: string,
    o: { text?: string; show_alert?: boolean } = {},
  ): Promise<unknown> {
    return this.call('answerCallbackQuery', {
      callback_query_id: id,
      ...(o.text ? { text: o.text.slice(0, 200) } : {}),
      ...(o.show_alert ? { show_alert: true } : {}),
    });
  }

  getChatMember(chatId: string | number, userId: number): Promise<{ status: string }> {
    return this.call<{ status: string }>('getChatMember', { chat_id: chatId, user_id: userId });
  }
}
