// 067 FR-UI-67-01 — màu chỉ khai báo trong khối token (đầu styles.css); phần còn lại dùng var(--…).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(__dirname, '../../src/renderer/styles.css'), 'utf8');

describe('styles tokens (067)', () => {
  it('has no hard-coded colours after the token block', () => {
    const rest = css.slice(css.indexOf('\n* {'));
    const hits = rest
      .split('\n')
      .map((l, i) => [i, l] as const)
      .filter(([, l]) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(l));
    expect(hits).toEqual([]);
  });
  it('defines a light theme', () => {
    expect(css).toContain(":root[data-theme='light']");
  });
});
