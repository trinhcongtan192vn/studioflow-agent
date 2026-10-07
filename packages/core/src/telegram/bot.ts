import {
  TelegramApiError,
  type InlineKeyboard,
  type ParseMode,
  type TelegramClient,
  type TgCallbackQuery,
  type TgMessage,
  type TgUpdate,
  type TgUser,
} from './client.js';

/**
 * Vòng nhận tin của bot (055): long polling, định tuyến lệnh / nhắc tên / trả lời bot / nhắn riêng, kiểm người
 * được phép, nút inline (`callback_query`). Chịu lỗi: lùi lại khi mạng lỗi, không bao giờ làm sập `core`;
 * 401 (token sai) và 409 (nơi khác đang `getUpdates`/webhook) → tự tắt kèm lý do rõ.
 */
export interface BotReply {
  text: string;
  parse_mode?: ParseMode;
  reply_markup?: InlineKeyboard;
}

export interface Sender {
  id: number;
  name: string;
}

export interface CommandCtx {
  command: string;
  args: string;
  chat_id: number;
  chat_type: TgMessage['chat']['type'];
  from: Sender;
  message_id: number;
}

export interface AskRequest {
  text: string;
  chat_id: number;
  from: Sender;
  message_id: number;
  /** Nội dung tin bot mà người dùng đang trả lời (nếu có) — ngữ cảnh cho agent. */
  reply_to_text?: string;
}

export type CommandHandler = (c: CommandCtx) => Promise<string | BotReply | void>;
export type CallbackHandler = (
  data: string,
  c: { from: Sender; chat_id: number; message_id?: number },
) => Promise<{ text?: string; alert?: boolean; clear_markup?: boolean } | void>;

export type BotStatus =
  | { state: 'stopped' }
  | { state: 'running'; bot_username?: string; last_poll_at?: string; last_error?: string }
  | { state: 'disabled'; reason: 'token_invalid' | 'conflict'; message: string };

export interface BotDeps {
  client: Pick<
    TelegramClient,
    | 'getMe'
    | 'getUpdates'
    | 'sendMessage'
    | 'answerCallbackQuery'
    | 'editMessageReplyMarkup'
    | 'getChatMember'
  >;
  /** Nhóm nhận thông báo (đọc lúc xử lý để đổi cấu hình có hiệu lực ngay). */
  chatId: () => string;
  allowedUserIds: () => string[];
  commands: Record<string, CommandHandler>;
  /** Câu hỏi tự do → phiên `ops`; trả văn bản trả lời. */
  ask?: (q: AskRequest) => Promise<string>;
  readOffset?: () => number | undefined;
  writeOffset?: (offset: number) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Ghi log (không chứa token). */
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  onStatus?: (s: BotStatus) => void;
}

export const BOT_BACKOFF = { MIN_MS: 1_000, MAX_MS: 60_000 } as const;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nameOf = (u: TgUser): string =>
  [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id);
const sender = (u: TgUser): Sender => ({ id: u.id, name: nameOf(u) });
const MEMBER = new Set(['creator', 'administrator', 'member', 'restricted']);

export class TelegramBot {
  private me?: TgUser;
  private running = false;
  private abort?: () => void;
  private loop?: Promise<void>;
  private readonly callbacks = new Map<string, CallbackHandler>();
  private readonly busy = new Set<number>();
  private _status: BotStatus = { state: 'stopped' };
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly d: BotDeps) {
    this.sleep = d.sleep ?? realSleep;
  }

  get status(): BotStatus {
    return this._status;
  }

  private setStatus(s: BotStatus): void {
    this._status = s;
    this.d.onStatus?.(s);
  }

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    this.d.log?.(level, msg);
  }

  /** Đăng ký xử lý nút inline theo tiền tố `callback_data` (`<tiền tố>:<phần còn lại>`). */
  onCallback(prefix: string, h: CallbackHandler): void {
    this.callbacks.set(prefix, h);
  }

  async identity(): Promise<TgUser> {
    this.me ??= await this.d.client.getMe();
    return this.me;
  }

  // ---------- vòng nhận tin ----------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abort?.();
    await this.loop?.catch(() => {});
    if (this._status.state === 'running') this.setStatus({ state: 'stopped' });
  }

  private async run(): Promise<void> {
    let delay: number = BOT_BACKOFF.MIN_MS;
    let offset = this.d.readOffset?.();
    while (this.running) {
      try {
        const me = await this.identity();
        this.setStatus({
          state: 'running',
          ...(me.username ? { bot_username: me.username } : {}),
          last_poll_at: (this.d.now?.() ?? new Date()).toISOString(),
        });
        const updates = await this.d.client.getUpdates(offset === undefined ? {} : { offset });
        delay = BOT_BACKOFF.MIN_MS;
        for (const u of updates) {
          if (!this.running) break;
          try {
            await this.handleUpdate(u);
          } catch (e) {
            // một tin lỗi không được làm kẹt vòng lặp hay làm sập core
            this.log(
              'error',
              `telegram: update ${u.update_id} failed: ${String((e as Error).message)}`,
            );
          }
          offset = u.update_id + 1;
          this.d.writeOffset?.(offset);
        }
      } catch (e) {
        const err = e as TelegramApiError;
        if (err instanceof TelegramApiError && err.status === 401) {
          this.running = false;
          this.setStatus({
            state: 'disabled',
            reason: 'token_invalid',
            message: 'Token bot Telegram không hợp lệ (401) — đặt lại token trong Cài đặt.',
          });
          return;
        }
        if (err instanceof TelegramApiError && err.status === 409) {
          this.running = false;
          this.setStatus({
            state: 'disabled',
            reason: 'conflict',
            message:
              'Một nơi khác đang nhận tin của bot này (getUpdates song song hoặc webhook, 409) — tắt nơi đó hoặc dùng bot khác.',
          });
          return;
        }
        const wait =
          err instanceof TelegramApiError && err.retryAfter ? err.retryAfter * 1000 : delay;
        delay = Math.min(delay * 2, BOT_BACKOFF.MAX_MS);
        const message = String((e as Error)?.message ?? e);
        this.log('warn', `telegram: poll failed, retry in ${wait} ms: ${message}`);
        this.setStatus({
          state: 'running',
          ...(this.me?.username ? { bot_username: this.me.username } : {}),
          last_error: message,
        });
        if (this.running) await this.sleep(wait);
      }
    }
  }

  // ---------- xử lý một tin ----------

  async handleUpdate(u: TgUpdate): Promise<void> {
    if (u.callback_query) return this.handleCallback(u.callback_query);
    if (u.message?.text !== undefined) return this.handleMessage(u.message);
  }

  /** Người gửi được phép ra lệnh không: danh sách rõ ràng, hoặc (rỗng) thành viên của nhóm đã cấu hình. */
  private async allowed(userId: number, chat: TgMessage['chat']): Promise<boolean> {
    const chatId = this.d.chatId();
    const list = this.d.allowedUserIds();
    if (list.length)
      return (
        list.includes(String(userId)) && (chat.type === 'private' || String(chat.id) === chatId)
      );
    if (!chatId) return false;
    if (String(chat.id) === chatId) return true;
    if (chat.type !== 'private') return false;
    // nhắn riêng khi không có danh sách: phải là thành viên của nhóm đã cấu hình
    try {
      return MEMBER.has((await this.d.client.getChatMember(chatId, userId)).status);
    } catch {
      return false;
    }
  }

  private async reply(
    chatId: number,
    messageId: number | undefined,
    r: string | BotReply,
  ): Promise<void> {
    const b = typeof r === 'string' ? { text: r } : r;
    try {
      await this.d.client.sendMessage(chatId, b.text, {
        ...(b.parse_mode ? { parse_mode: b.parse_mode } : {}),
        ...(b.reply_markup ? { reply_markup: b.reply_markup } : {}),
        ...(messageId ? { reply_to_message_id: messageId } : {}),
      });
    } catch (e) {
      this.log('warn', `telegram: reply failed: ${String((e as Error).message)}`);
    }
  }

  private async handleMessage(m: TgMessage): Promise<void> {
    const from = m.from;
    if (!from || from.is_bot || m.chat.type === 'channel') return;
    const me = await this.identity();
    const text = m.text ?? '';
    // lệnh: /cmd, /cmd@bot, /cmd tham số
    const cmd = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
    const mention = this.mentioned(m, me);
    const toBot = m.reply_to_message?.from?.id === me.id;
    const isPrivate = m.chat.type === 'private';
    if (cmd) {
      // lệnh gửi riêng cho bot khác trong cùng nhóm
      if (cmd[2] && cmd[2].toLowerCase() !== (me.username ?? '').toLowerCase()) return;
    } else if (!(isPrivate || mention || toBot)) return;
    if (!(await this.allowed(from.id, m.chat))) {
      // lệnh/nhắc tên từ người lạ: im lặng (không lộ bot cho người ngoài nhóm)
      return;
    }
    const who = sender(from);
    if (cmd) {
      const name = cmd[1]!.toLowerCase();
      const h = this.d.commands[name] ?? (name === 'start' ? this.d.commands.help : undefined);
      if (!h) {
        await this.reply(
          m.chat.id,
          m.message_id,
          `Chưa có lệnh /${name}. Gõ /help để xem danh sách.`,
        );
        return;
      }
      try {
        const r = await h({
          command: name,
          args: (cmd[3] ?? '').trim(),
          chat_id: m.chat.id,
          chat_type: m.chat.type,
          from: who,
          message_id: m.message_id,
        });
        if (r) await this.reply(m.chat.id, m.message_id, r);
      } catch (e) {
        await this.reply(
          m.chat.id,
          m.message_id,
          `Lỗi khi chạy /${name}: ${String((e as Error).message)}`,
        );
      }
      return;
    }
    const question = this.stripMention(text, me).trim();
    if (!question) return;
    if (!this.d.ask) {
      await this.reply(m.chat.id, m.message_id, 'Chưa bật trả lời câu hỏi tự do.');
      return;
    }
    if (this.busy.has(m.chat.id)) {
      await this.reply(m.chat.id, m.message_id, 'Đang xử lý câu hỏi trước, bạn đợi chút nhé.');
      return;
    }
    this.busy.add(m.chat.id);
    try {
      const answer = await this.d.ask({
        text: question,
        chat_id: m.chat.id,
        from: who,
        message_id: m.message_id,
        ...(toBot && m.reply_to_message?.text ? { reply_to_text: m.reply_to_message.text } : {}),
      });
      await this.reply(m.chat.id, m.message_id, answer || 'Mình chưa có câu trả lời cho việc này.');
    } catch (e) {
      await this.reply(
        m.chat.id,
        m.message_id,
        `Không trả lời được: ${String((e as Error).message)}`,
      );
    } finally {
      this.busy.delete(m.chat.id);
    }
  }

  private mentioned(m: TgMessage, me: TgUser): boolean {
    const text = m.text ?? '';
    const user = (me.username ?? '').toLowerCase();
    return (m.entities ?? []).some(
      (e) =>
        (e.type === 'mention' &&
          text.slice(e.offset, e.offset + e.length).toLowerCase() === `@${user}`) ||
        (e.type === 'text_mention' && e.user?.id === me.id),
    );
  }

  private stripMention(text: string, me: TgUser): string {
    const user = me.username ? new RegExp(`@${me.username}`, 'gi') : undefined;
    return user ? text.replace(user, ' ').replace(/\s+/g, ' ') : text;
  }

  private async handleCallback(q: TgCallbackQuery): Promise<void> {
    const chat = q.message?.chat;
    const ok = chat ? await this.allowed(q.from.id, chat) : false;
    if (!ok) {
      await this.d.client
        .answerCallbackQuery(q.id, { text: 'Bạn không có quyền dùng nút này.', show_alert: true })
        .catch(() => {});
      return;
    }
    const data = q.data ?? '';
    const prefix = data.split(':')[0]!;
    const h = this.callbacks.get(prefix);
    if (!h) {
      await this.d.client
        .answerCallbackQuery(q.id, { text: 'Nút này không còn dùng được.' })
        .catch(() => {});
      return;
    }
    let res: Awaited<ReturnType<CallbackHandler>>;
    try {
      res = await h(data.slice(prefix.length + 1), {
        from: sender(q.from),
        chat_id: chat!.id,
        ...(q.message ? { message_id: q.message.message_id } : {}),
      });
    } catch (e) {
      res = { text: `Lỗi: ${String((e as Error).message)}`, alert: true };
    }
    await this.d.client
      .answerCallbackQuery(q.id, {
        ...(res?.text ? { text: res.text } : {}),
        ...(res?.alert ? { show_alert: true } : {}),
      })
      .catch(() => {});
    if (res?.clear_markup && q.message)
      await this.d.client.editMessageReplyMarkup(chat!.id, q.message.message_id).catch(() => {});
  }
}
