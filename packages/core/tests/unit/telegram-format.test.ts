// 055 · FR-AP-11 — định dạng tin Telegram (/status, /plan, thông báo vận hành) và bộ thông báo.
import { describe, expect, it } from 'vitest';
import type { AutopilotStatus } from '../../src/autopilot/runner.js';
import { formatNotification, formatPlans, formatStatus, hhmm } from '../../src/telegram/format.js';
import { compositeNotifier, TelegramNotifier } from '../../src/telegram/notifier.js';

const status = (o: Partial<AutopilotStatus> = {}): AutopilotStatus => ({
  paused: false,
  running: false,
  today: [
    {
      channel: '/k/a',
      name: 'Sử <Việt> & Đời',
      date: '2026-10-07',
      items: [
        {
          id: 'pi_1',
          title: 'Trận Bạch Đằng',
          status: 'produced',
          publish_at: '2026-10-07T12:00:00+07:00',
        },
        {
          id: 'pi_2',
          title: 'Hội nghị Diên Hồng',
          status: 'needs_review',
          publish_at: '2026-10-07T19:00:00+07:00',
          note: 'Điểm chốt script: điểm 6,5 thấp hơn ngưỡng 8',
        },
        { id: 'pi_3', title: 'Chợ nổi', status: 'planned', publish_at: null },
      ],
    },
  ],
  ...o,
});

describe('formatStatus / formatPlans', () => {
  it('summarises state and per-status counts, escaping HTML in names', () => {
    const t = formatStatus(status());
    expect(t).toContain('Autopilot đang chờ lượt');
    expect(t).toContain('Sử &lt;Việt&gt; &amp; Đời');
    expect(t).toContain('1 đã xong');
    expect(t).toContain('1 cần bạn xem');
    expect(t).toContain('1 chờ làm');
  });
  it('paused / running / waiting for the Claude limit / current video', () => {
    expect(formatStatus(status({ paused: true }))).toContain('tạm dừng');
    const t = formatStatus(
      status({
        running: true,
        waiting_until: '2026-10-07T16:01:00.000Z',
        current: { channel: '/k/a', item_id: 'pi_2', title: 'Hội nghị', step_id: 'voice' },
      }),
    );
    expect(t).toContain('đang chạy');
    expect(t).toContain('2026-10-07T16:01:00.000Z');
    expect(t).toContain('bước voice');
    expect(formatStatus({ paused: false, running: false, today: [] })).toContain(
      'Chưa có kênh nào',
    );
  });
  it('plan lists the items with the local time, status and the note of parked ones', () => {
    const t = formatPlans(status());
    expect(t).toContain('12:00 Trận Bạch Đằng — đã xong');
    expect(t).toContain('19:00 Hội nghị Diên Hồng — cần bạn xem: Điểm chốt script');
    expect(t).toContain('--:-- Chợ nổi — chờ làm');
    expect(hhmm('2026-10-07T05:30:00-05:00')).toBe('05:30');
  });
});

describe('formatNotification', () => {
  const ev = (kind: string) => ({
    kind,
    channel: '/k/a',
    channel_name: 'Sử Việt',
    level: 'warn' as const,
    message: 'Đỗ "A", cần người xem: điểm 6,5 <thấp>',
  });
  it('parked / failed / limit / plan are announced with the channel name and escaped text', () => {
    for (const k of ['item.parked', 'item.failed', 'limit.hit', 'plan.built'])
      expect(formatNotification(ev(k))).toContain('<b>Sử Việt</b>');
    expect(formatNotification(ev('item.parked'))).toContain('&lt;thấp&gt;');
  });
  it('other events are not announced', () => {
    for (const k of ['gate.decision', 'item.start', 'step.retry', 'voice.default'])
      expect(formatNotification(ev(k))).toBeUndefined();
  });
});

describe('TelegramNotifier', () => {
  const sent: { chat: string | number; text: string; opts: unknown }[] = [];
  const mk = (o: { enabled?: boolean; chat?: string; client?: boolean; fail?: boolean } = {}) => {
    sent.length = 0;
    const logs: string[] = [];
    const n = new TelegramNotifier({
      client: () =>
        o.client === false
          ? undefined
          : {
              sendMessage: async (chat, text, opts) => {
                if (o.fail) throw new Error('mạng chết');
                sent.push({ chat, text, opts });
                return [];
              },
            },
      chatId: () => o.chat ?? '-100',
      enabled: () => o.enabled ?? true,
      log: (m) => logs.push(m),
    });
    return { n, logs };
  };
  const e = {
    kind: 'item.failed',
    channel: '/k/a',
    channel_name: 'K',
    level: 'error' as const,
    message: 'Hỏng',
  };

  it('sends HTML to telegram.chat_id when enabled, in order', async () => {
    const { n } = mk();
    await Promise.all([n.notify(e), n.notify({ ...e, kind: 'plan.built', message: 'Kế hoạch' })]);
    expect(sent.map((s) => s.text)).toEqual(['❌ <b>K</b>\nHỏng', '🗓 <b>K</b>\nKế hoạch']);
    expect(sent[0]).toMatchObject({ chat: '-100', opts: { parse_mode: 'HTML' } });
  });
  it('does nothing when disabled, without chat id, without client, or for ignored events', async () => {
    await mk({ enabled: false }).n.notify(e);
    await mk({ chat: '' }).n.notify(e);
    await mk({ client: false }).n.notify(e);
    await mk().n.notify({ ...e, kind: 'gate.decision' });
    expect(sent).toHaveLength(0);
  });
  it('a network failure is logged, never thrown', async () => {
    const { n, logs } = mk({ fail: true });
    await expect(n.notify(e)).resolves.toBeUndefined();
    expect(logs[0]).toContain('mạng chết');
  });
  it('composite notifier survives a failing member', async () => {
    const got: string[] = [];
    const c = compositeNotifier(
      { notify: () => Promise.reject(new Error('x')) },
      { notify: (ev) => void got.push(ev.kind) },
    );
    await c.notify(e);
    expect(got).toEqual(['item.failed']);
  });
});
