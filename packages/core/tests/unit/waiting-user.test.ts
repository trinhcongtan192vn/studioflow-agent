// Bước Đăng ở chế độ thủ công chưa được bấm (2026-10-10): không phải lỗi — thẻ video "chờ", không "lỗi".
import { expect, it } from 'vitest';
import { videoStatus } from '../../src/domain/video-card.js';
import { isWaitingUser, PUBLISH_CHOOSE } from '../../src/workflow/waiting.js';

it('a publish step waiting for the user counts as waiting, a real failure still fails', () => {
  const waiting = {
    status: 'failed',
    error: { code: 'E_STEP_INCOMPLETE', message: `choose the platforms — ${PUBLISH_CHOOSE}` },
  };
  expect(isWaitingUser(waiting)).toBe(true);
  expect(videoStatus('workflow', { render: { status: 'done' }, publish: waiting })).toBe('waiting');
  expect(
    videoStatus('workflow', {
      render: { status: 'failed', error: { code: 'E_GATE_FAILED', message: 'x' } } as never,
    }),
  ).toBe('failed');
});
