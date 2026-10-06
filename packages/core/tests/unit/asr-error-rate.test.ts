// 038 — kiểm đọc sai tiếng Việt: Whisper dính chữ ("ngayạ") và lẫn phụ âm đầu (tr/ch, s/x, d/gi/r)
// không bị tính là đọc sai; đọc sai thật vẫn bị bắt.
import { describe, expect, it } from 'vitest';
import { asrErrorRate } from '../../src/asr/text.js';

const T = 0.15;
describe('asrErrorRate (vi)', () => {
  it('real lines from "Cậu bé và con trâu" that were read correctly pass', () => {
    const cases: [string, string][] = [
      ['Dạ! Cháu đi ngay ạ!', 'Dạ, cháu đi ngayạ.'],
      [
        'Tí dắt trâu đi trên đường làng, vừa đi vừa huýt sáo.',
        'Tí dắt châu đi trên đường làng, vừa đi vừa huyết sáo.',
      ],
      [
        'Dạ... trâu... trâu nó tự bỏ đi ạ. Cháu... à không...',
        'Dạ châu châu nó tự bỏ điạ, cháu à không?',
      ],
      [
        'Ông ơi... cháu buộc ẩu, bỏ đi chơi. Lỗi của cháu ạ.',
        'Ông ơi, cháu buộcẩu bỏ đi chơi lỗi của cháuạ.',
      ],
      ['Cháu xin lỗi bác. Để cháu dặm lại lúa ạ.', 'Cháu xin lỗi bác, để cháu dặm lại lúaạ.'],
    ];
    for (const [ref, hyp] of cases)
      expect(asrErrorRate(ref, hyp, 'vi'), `${ref} ← ${hyp}`).toBeLessThanOrEqual(T);
  });
  it('a genuinely misread or truncated line is still caught', () => {
    expect(
      asrErrorRate('Cháu xin lỗi bác. Để cháu dặm lại lúa ạ.', 'Cháu xin lỗi bác.', 'vi'),
    ).toBeGreaterThan(T);
    expect(
      asrErrorRate(
        'Năm một nghìn bốn trăm hai mươi tám, Lê Lợi lên ngôi.',
        'Năm một nghìn bốn trăm, vua lên ngôi báu rồi.',
        'vi',
      ),
    ).toBeGreaterThan(T);
  });
  it('other languages keep word error rate', () => {
    expect(asrErrorRate('the sky is blue', 'the sky is blue', 'en')).toBe(0);
    expect(asrErrorRate('the sky is blue', 'the sky was green', 'en')).toBe(0.5);
  });
});
