// 052 — màn Autopilot + chạy nền: câu trạng thái, nhãn mục, trạng thái gửi `main`, hành vi nút đóng.
import { describe, expect, it } from 'vitest';
import {
  closeAction,
  desktopState,
  itemStatusLabel,
  itemSummary,
  statusLine,
} from '../../src/renderer/autopilot-view';

const day = (statuses: string[]) => [
  {
    channel: 'C:/k',
    name: 'Kênh',
    date: '2026-10-07',
    items: statuses.map((status) => ({ status })),
  },
];

describe('autopilot view', () => {
  it('status line', () => {
    expect(statusLine({ paused: true, running: false, today: day([]) })).toBe(
      'Autopilot đang tạm dừng.',
    );
    expect(
      statusLine({
        paused: false,
        running: false,
        waiting_until: '2026-10-07T20:00:00',
        today: day([]),
      }),
    ).toBe('Hết hạn mức Claude — chờ tới 20:00 rồi làm tiếp.');
    expect(
      statusLine({
        paused: false,
        running: true,
        current: { channel: 'C:/k', item_id: 'pi_1', title: 'Nhật thực', step_id: 'frames' },
        today: day(['in_production']),
      }),
    ).toBe('Đang làm: "Nhật thực" — bước frames.');
    expect(
      statusLine({ paused: false, running: false, today: day(['planned', 'produced']) }),
    ).toMatch(/còn 1 video/);
    expect(statusLine({ paused: false, running: false, today: day(['produced']) })).toBe(
      'Đã xong kế hoạch hôm nay.',
    );
    expect(statusLine({ paused: false, running: false, today: [] })).toBe(
      'Chưa có kênh nào bật Autopilot.',
    );
  });
  it('item labels and summary', () => {
    expect(itemStatusLabel('needs_review')).toBe('Cần bạn xem');
    expect(itemSummary(day(['produced', 'produced', 'needs_review'])[0]!.items)).toBe(
      '2 đã làm xong · 1 cần bạn xem',
    );
  });
  it('desktop state and close behaviour', () => {
    const s = { paused: false, running: true, today: day(['in_production']) };
    expect(desktopState(s, { anyAutopilot: true, background: true })).toEqual({
      background: true,
      producing: true,
      paused: false,
      any: true,
    });
    expect(desktopState(s, { anyAutopilot: false, background: true }).background).toBe(false);
    expect(
      desktopState({ ...s, paused: true }, { anyAutopilot: true, background: true }).producing,
    ).toBe(false);
    expect(closeAction({ quit: false, background: true, paused: false })).toBe('hide');
    expect(closeAction({ quit: true, background: true, paused: false })).toBe('check');
    expect(closeAction({ quit: false, background: false, paused: false })).toBe('check');
    // 090 FR-AP-90-01: Autopilot tạm dừng → chạy nền vô ích, kiểm việc dở như thường
    expect(closeAction({ quit: false, background: true, paused: true })).toBe('check');
  });
});
