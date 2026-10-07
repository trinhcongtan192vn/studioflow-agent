import type { TelegramClient } from './client.js';
import { formatNotification, type NotifyEvent } from './format.js';

export type { NotifyEvent };

/** Cổng thông báo của Autopilot (055): 052 và các tính năng đăng bài/báo cáo gọi `notify`; không bao giờ ném lỗi. */
export interface Notifier {
  notify(event: NotifyEvent): void | Promise<void>;
}

export const nullNotifier: Notifier = { notify() {} };

/** Gửi nhiều nơi nhận (ví dụ Telegram + màn hình ứng dụng sau này). */
export function compositeNotifier(...ns: Notifier[]): Notifier {
  return {
    async notify(e) {
      await Promise.all(ns.map((n) => Promise.resolve(n.notify(e)).catch(() => {})));
    },
  };
}

/**
 * Thông báo vào nhóm Telegram khi `telegram.enabled` và đã có `telegram.chat_id`; gửi tuần tự để giữ thứ tự,
 * lỗi mạng chỉ ghi log (thông báo là phụ, không được làm hỏng Autopilot).
 */
export class TelegramNotifier implements Notifier {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly d: {
      client: () => Pick<TelegramClient, 'sendMessage'> | undefined;
      chatId: () => string;
      enabled: () => boolean;
      log?: (msg: string) => void;
    },
  ) {}

  notify(ev: NotifyEvent): Promise<void> {
    const text = formatNotification(ev);
    if (!text || !this.d.enabled()) return Promise.resolve();
    const client = this.d.client();
    const chat = this.d.chatId();
    if (!client || !chat) return Promise.resolve();
    const run = this.chain.then(() =>
      client.sendMessage(chat, text, { parse_mode: 'HTML' }).then(
        () => undefined,
        (e: unknown) => {
          this.d.log?.(`telegram notify failed: ${String((e as Error)?.message)}`);
        },
      ),
    );
    this.chain = run;
    return run as Promise<void>;
  }
}
