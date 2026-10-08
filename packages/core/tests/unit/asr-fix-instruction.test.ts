// 079 — chỉ dẫn sửa cách đọc gửi agent của video Autopilot.
import { describe, expect, it } from 'vitest';
import { asrFixInstruction } from '../../src/autopilot/brief.js';

describe('asrFixInstruction (079)', () => {
  it('names the lines with their error rate, the sf:tts form and the asr.align call', () => {
    const t = asrFixInstruction([
      { line_id: 'ln_aaaaaaaa', wer: 0.4 },
      { line_id: 'ln_bbbbbbbb', wer: 0.31 },
    ]);
    expect(t).toMatch(/ln_aaaaaaaa \(lệch 40%\), ln_bbbbbbbb \(lệch 31%\)/);
    expect(t).toContain('<!-- sf:tts text="…" -->');
    expect(t).toContain('asr.align với line_ids ["ln_aaaaaaaa", "ln_bbbbbbbb"]');
    expect(t).toMatch(/không hỏi lại/);
    expect(t).toContain('job.wait');
  });
});
