import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAppConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';
import type { AutopilotRunner } from '../autopilot/runner.js';
import type { SecretStore } from '../secrets/store.js';
import { writeOutsideProject } from '../store/scratch.js';
import { TelegramBot, type BotReply, type BotStatus, type CommandCtx } from './bot.js';
import { TelegramClient, type FetchLike, type InlineKeyboard } from './client.js';
import { formatPlans, formatStatus, HELP_TEXT } from './format.js';
import { TelegramNotifier, type Notifier } from './notifier.js';
import type { OpsAgent } from './ops.js';

export const TELEGRAM_TOKEN_SECRET = 'telegram_bot_token';

export interface TelegramStatus {
  enabled: boolean;
  state: BotStatus['state'];
  reason?: string;
  message?: string;
  bot_username?: string;
  chat_id_set: boolean;
  has_token: boolean;
  last_error?: string;
}

export interface TelegramServiceDeps {
  appDataDir: string;
  secrets: SecretStore;
  runner: Pick<AutopilotRunner, 'status' | 'setPaused'>;
  ops?: Pick<OpsAgent, 'ask'>;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** /report (054): trả văn bản báo cáo; chưa có thì lệnh nói rõ. */
  report?: (ctx: CommandCtx) => Promise<string | BotReply | void>;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  onChange?: () => void;
}

/**
 * Dịch vụ Telegram của host (055): dựng client từ bí mật `telegram_bot_token`, chạy/dừng bot theo
 * `telegram.enabled`, lệnh /status /plan /pause /resume /report /help, câu hỏi tự do → agent `ops`, và bộ
 * thông báo cho Autopilot. Lỗi mạng/API không bao giờ ném ra ngoài.
 */
export class TelegramService {
  private client?: TelegramClient;
  private bot?: TelegramBot;
  private botStatus: BotStatus = { state: 'stopped' };
  readonly notifier: Notifier;
  private readonly offsetFile: string;

  constructor(private readonly d: TelegramServiceDeps) {
    this.offsetFile = path.join(d.appDataDir, 'telegram', 'offset.json');
    this.notifier = new TelegramNotifier({
      client: () => this.client,
      chatId: () => this.chatId(),
      enabled: () => this.enabled(),
      log: (m) => d.log?.('warn', m),
    });
  }

  private cfg<T>(key: string): T {
    return resolveAppConfig<T>(key, { appDataDir: this.d.appDataDir });
  }
  private enabled = (): boolean => this.cfg<boolean>('telegram.enabled') === true;
  private chatId = (): string => String(this.cfg<string>('telegram.chat_id') ?? '').trim();
  private allowed = (): string[] =>
    (this.cfg<string[]>('telegram.allowed_user_ids') ?? [])
      .map((x) => String(x).trim())
      .filter(Boolean);

  private readOffset = (): number | undefined => {
    try {
      const o = JSON.parse(readFileSync(this.offsetFile, 'utf8')) as { offset?: number };
      return typeof o.offset === 'number' ? o.offset : undefined;
    } catch {
      return undefined;
    }
  };
  private writeOffset = (offset: number): void => {
    try {
      writeOutsideProject(this.offsetFile, `${JSON.stringify({ offset })}\n`);
    } catch {
      /* mất offset chỉ làm nhận lại vài tin — chấp nhận */
    }
  };

  // ---------- vòng đời ----------

  /** Đọc lại cấu hình/token và chạy hoặc dừng bot cho đúng. Không ném lỗi. */
  async reconfigure(): Promise<void> {
    await this.bot?.stop();
    this.bot = undefined;
    this.client = undefined;
    this.botStatus = { state: 'stopped' };
    try {
      const token = await this.d.secrets.get(TELEGRAM_TOKEN_SECRET);
      if (token) this.client = new TelegramClient({ token, ...this.opts() });
      if (this.enabled() && this.client) this.startBot(this.client);
    } catch (e) {
      this.d.log?.('warn', `telegram: cannot start: ${String((e as Error).message)}`);
    }
    this.d.onChange?.();
  }

  private opts() {
    return {
      ...(this.d.fetch ? { fetch: this.d.fetch } : {}),
      ...(this.d.sleep ? { sleep: this.d.sleep } : {}),
    };
  }

  private startBot(client: TelegramClient): void {
    const bot = new TelegramBot({
      client,
      chatId: this.chatId,
      allowedUserIds: this.allowed,
      commands: this.commands(),
      ...(this.d.ops
        ? {
            ask: (q) => {
              const who = q.from.name;
              const ctx = q.reply_to_text
                ? `\n(Đang trả lời tin của bot: “${q.reply_to_text.slice(0, 300)}”)`
                : '';
              return this.d.ops!.ask(String(q.chat_id), `[Telegram · ${who}] ${q.text}${ctx}`);
            },
          }
        : {}),
      readOffset: this.readOffset,
      writeOffset: this.writeOffset,
      ...(this.d.sleep ? { sleep: this.d.sleep } : {}),
      ...(this.d.log ? { log: this.d.log } : {}),
      onStatus: (s) => {
        this.botStatus = s;
        this.d.onChange?.();
      },
    });
    this.bot = bot;
    for (const [p, h] of this.pendingCallbacks) bot.onCallback(p, h);
    bot.start();
  }

  /** Tin xem trước bản đăng (053) kèm nút inline vào `telegram.chat_id`; chưa bật/chưa có token → bỏ qua. */
  async sendPreview(m: {
    text: string;
    photo?: { bytes: Uint8Array; filename: string };
    buttons: { text: string; data: string }[][];
  }): Promise<void> {
    const client = this.client;
    const chat = this.chatId();
    if (!client || !chat || !this.enabled()) return;
    const kb: InlineKeyboard = {
      inline_keyboard: m.buttons.map((r) =>
        r.map((b) => ({ text: b.text, callback_data: b.data })),
      ),
    };
    if (m.photo)
      await client.sendPhoto(chat, m.photo, {
        caption: m.text,
        parse_mode: 'HTML',
        reply_markup: kb,
      });
    else await client.sendMessage(chat, m.text, { parse_mode: 'HTML', reply_markup: kb });
  }

  /** Cho tính năng sau (053 nút Hủy/Đăng ngay…) đăng ký xử lý nút inline. */
  onCallback(prefix: string, h: Parameters<TelegramBot['onCallback']>[1]): void {
    this.pendingCallbacks.push([prefix, h]);
    this.bot?.onCallback(prefix, h);
  }
  private readonly pendingCallbacks: [string, Parameters<TelegramBot['onCallback']>[1]][] = [];

  async close(): Promise<void> {
    await this.bot?.stop();
  }

  // ---------- lệnh ----------

  private commands() {
    const html = (text: string): BotReply => ({ text, parse_mode: 'HTML' });
    return {
      help: async () => html(HELP_TEXT),
      status: async () => html(formatStatus(this.d.runner.status())),
      plan: async () => html(formatPlans(this.d.runner.status())),
      pause: async () => {
        this.d.runner.setPaused(true);
        return '⏸ Đã tạm dừng Autopilot (video đang làm dở có thể xong). Gõ /resume để tiếp tục.';
      },
      resume: async () => {
        this.d.runner.setPaused(false);
        return '▶️ Đã tiếp tục Autopilot.';
      },
      report: async (c: CommandCtx) =>
        (await this.d.report?.(c)) ?? 'Báo cáo hằng ngày chưa sẵn sàng ở bản này.',
    };
  }

  // ---------- trạng thái / thử ----------

  async status(): Promise<TelegramStatus> {
    let has_token = false;
    try {
      has_token = Boolean(await this.d.secrets.get(TELEGRAM_TOKEN_SECRET));
    } catch {
      /* không đọc được kho bí mật → coi như chưa có */
    }
    const b = this.botStatus;
    return {
      enabled: this.enabled(),
      state: b.state,
      ...(b.state === 'disabled' ? { reason: b.reason, message: b.message } : {}),
      ...(b.state === 'running' && b.bot_username ? { bot_username: b.bot_username } : {}),
      ...(b.state === 'running' && b.last_error ? { last_error: b.last_error } : {}),
      chat_id_set: Boolean(this.chatId()),
      has_token,
    };
  }

  /** Tin thử vào `telegram.chat_id`. */
  async test(): Promise<{ ok: true }> {
    const token = await this.d.secrets.get(TELEGRAM_TOKEN_SECRET);
    if (!token)
      throw new SfError(
        'E_PROVIDER_UNAVAILABLE',
        'chưa có token bot Telegram (telegram_bot_token)',
      );
    const chat = this.chatId();
    if (!chat) throw new SfError('E_SCHEMA_INVALID', 'telegram.chat_id chưa được đặt');
    const client = this.client ?? new TelegramClient({ token, ...this.opts() });
    try {
      await client.sendMessage(chat, '✅ StudioFlow đã kết nối Telegram. Gõ /help để xem lệnh.');
    } catch (e) {
      throw new SfError('E_PROVIDER_FAILED', String((e as Error).message));
    }
    return { ok: true };
  }

  /** Kiểm token bằng `getMe`, lưu bí mật, khởi động lại bot. */
  async setToken(token: string): Promise<{ ok: true; bot_username?: string }> {
    const t = token.trim();
    if (!/^\d+:[\w-]{20,}$/.test(t))
      throw new SfError('E_SCHEMA_INVALID', 'token bot Telegram sai dạng (<số>:<chuỗi>)');
    let me;
    try {
      me = await new TelegramClient({ token: t, ...this.opts() }).getMe();
    } catch (e) {
      throw new SfError(
        'E_PROVIDER_FAILED',
        `token bot không dùng được: ${String((e as Error).message)}`,
      );
    }
    await this.d.secrets.set(TELEGRAM_TOKEN_SECRET, t);
    await this.reconfigure();
    return { ok: true, ...(me.username ? { bot_username: me.username } : {}) };
  }
}
