// 083 — trạng thái bot Telegram ở Cài đặt: đang kết nối thay vì "đang dừng"; gửi tin thử chỉ cần token + chat ID.
import { describe, expect, it } from 'vitest';
import { canTestTelegram, tgStateLabel, type TgStatus } from '../../src/renderer/telegram-format';

const st = (o: Partial<TgStatus>): TgStatus => ({
  enabled: true,
  state: 'stopped',
  chat_id_set: true,
  has_token: true,
  ...o,
});

describe('telegram-format (083)', () => {
  it('labels the bot state', () => {
    expect(tgStateLabel(st({}))).toBe('Đang kết nối…');
    expect(tgStateLabel(st({ has_token: false }))).toBe('Chưa có token');
    expect(tgStateLabel(st({ enabled: false }))).toBe('Đang tắt');
    expect(tgStateLabel(st({ state: 'running' }))).toBe('Đang chạy');
    expect(tgStateLabel(st({ state: 'disabled' }))).toBe('Lỗi kết nối');
  });
  it('test message needs only a token and a chat id', () => {
    expect(canTestTelegram(st({}))).toBe(true);
    expect(canTestTelegram(st({ enabled: false }))).toBe(true);
    expect(canTestTelegram(st({ chat_id_set: false }))).toBe(false);
    expect(canTestTelegram(st({ has_token: false }))).toBe(false);
    expect(canTestTelegram(undefined)).toBe(false);
  });
});
