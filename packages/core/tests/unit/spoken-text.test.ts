// sf:tts gộp cả câu trước (vd_bjoza2qu, 2026-10-10) → giọng đọc lặp, lệch phụ đề; app đọc đúng chữ của line.
import { expect, it } from 'vitest';
import { spokenText } from '../../src/tts/spoken.js';

const lines = [
  { id: 'ln_1', text: 'You think you know your own planet.' },
  {
    id: 'ln_2',
    text: 'But most of its ocean floor is still a blank on the map.',
    tts_text:
      'You think you know your own planet. But most of its ocean floor is still a blank on the map.',
  },
  {
    id: 'ln_3',
    text: '71% of Earth is ocean.',
    tts_text: 'Seventy-one percent of Earth is ocean.',
  },
  { id: 'ln_4', text: 'You listen.' },
  {
    id: 'ln_5',
    text: 'The echo returns.',
    tts_text: 'So how do you map it? You listen. Ships send sound waves down. The echo returns.',
  },
];

it('a tts override that repeats another line is dropped; a pronunciation override is kept', () => {
  expect(spokenText(lines[1]!, lines)).toBe(lines[1]!.text);
  expect(spokenText(lines[2]!, lines)).toBe('Seventy-one percent of Earth is ocean.');
  // dài hơn hẳn chữ hiển thị (gộp nhiều câu ngắn) → bỏ
  expect(spokenText(lines[4]!, lines)).toBe('The echo returns.');
  expect(spokenText(lines[0]!, lines)).toBe(lines[0]!.text);
});
