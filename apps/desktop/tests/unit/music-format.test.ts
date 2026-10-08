// 084 — tab Nhạc: tiến độ và kết quả nạp hàng loạt.
import { describe, expect, it } from 'vitest';
import { importProgress, importSummary } from '../../src/renderer/music-format';

describe('music-format (084)', () => {
  it('shows import progress', () => {
    expect(importProgress(0, 0)).toBe('Đang chuẩn bị…');
    expect(importProgress(123, 1000)).toBe('Đang nạp 123/1000 bài (12%)');
  });
  it('summarizes new, duplicate and skipped files', () => {
    expect(
      importSummary(
        {
          track_ids: ['mt_1', 'mt_2', 'mt_old'],
          skipped: [{ file: 'E:\\Nhạc\\x.mp3', reason: 'E_AUDIO_ANALYSIS: bad' }],
        },
        new Set(['mt_old']),
        'app',
      ),
    ).toBe(
      'Đã nạp 2 bài mới vào kho app · 1 bài đã có sẵn · bỏ qua 1 file (ví dụ x.mp3: E_AUDIO_ANALYSIS: bad).',
    );
    expect(importSummary({ track_ids: ['a'], skipped: [] }, new Set(), 'channel')).toBe(
      'Đã nạp 1 bài mới vào kho kênh.',
    );
  });
});
