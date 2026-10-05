// 033 · SC-002 — ghép instruct OmniVoice từ đầu vào có cấu trúc; câu mẫu mặc định theo ngôn ngữ.
import { describe, expect, it } from 'vitest';
import { defaultSampleText, designInstruct } from '../../src/tts/design.js';

describe('designInstruct', () => {
  it('joins gender, age and pitch in OmniVoice vocabulary', () => {
    expect(designInstruct({ gender: 'female', age: 'young adult', pitch: 'moderate' }, 'vi')).toBe(
      'female, young adult, moderate pitch',
    );
    expect(
      designInstruct({ gender: 'male', age: 'elderly', pitch: 'very low', whisper: true }, 'vi'),
    ).toBe('male, elderly, very low pitch, whisper');
  });
  it('accent only for English', () => {
    expect(
      designInstruct({ gender: 'male', age: 'middle-aged', pitch: 'low', accent: 'british' }, 'en'),
    ).toBe('male, middle-aged, low pitch, british accent');
    expect(() =>
      designInstruct({ gender: 'male', age: 'middle-aged', pitch: 'low', accent: 'british' }, 'vi'),
    ).toThrow(/accent/);
  });
});

describe('defaultSampleText', () => {
  it('has a sample of about 6–9 s of speech for every app language', () => {
    for (const lang of ['vi', 'de', 'en']) {
      const t = defaultSampleText(lang);
      expect(t.length).toBeGreaterThanOrEqual(90);
      expect(t.length).toBeLessThanOrEqual(160);
    }
  });
});
