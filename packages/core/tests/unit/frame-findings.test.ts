// 011/016 — lỗi lint/check gán đúng frame để vòng sửa gửi lại cho agent (đường dẫn Windows, selector).
import { describe, expect, it } from 'vitest';
import { frameOfFinding } from '../../src/hf/frame-build.js';

describe('frameOfFinding', () => {
  it('reads the frame id from Windows and POSIX paths', () => {
    expect(
      frameOfFinding(
        'E:\\0. Làm Youtuber\\Test kênh\\videos\\vd_jegcn38v\\compositions\\frames\\fr_xklyxpsa.html',
      ),
    ).toBe('fr_xklyxpsa');
    expect(frameOfFinding('compositions/frames/fr_9x2b7cqe.html')).toBe('fr_9x2b7cqe');
  });
  it('falls back to the <frame_id>- prefix of the selector or element id', () => {
    expect(frameOfFinding('', '#fr_xklyxpsa-title')).toBe('fr_xklyxpsa');
    expect(frameOfFinding('index.html', undefined, 'fr_3m8k1w7d-bg')).toBe('fr_3m8k1w7d');
    expect(frameOfFinding('index.html', '#root')).toBeUndefined();
  });
});
