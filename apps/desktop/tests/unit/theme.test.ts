// 067 FR-UI-67-02 — giao diện Tối (mặc định) / Sáng / Theo Windows, nhớ theo máy.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, loadTheme } from '../../src/renderer/theme';

const store = new Map<string, string>();
afterEach(() => {
  vi.unstubAllGlobals();
  store.clear();
});
const stub = () => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
  vi.stubGlobal('document', { documentElement: { dataset: {} as Record<string, string> } });
};

describe('theme (067)', () => {
  it('defaults to dark, also without storage', () => {
    expect(loadTheme()).toBe('dark');
    stub();
    expect(loadTheme()).toBe('dark');
  });
  it('remembers the choice and sets data-theme', () => {
    stub();
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(loadTheme()).toBe('light');
    store.set('sf.theme', 'nonsense');
    expect(loadTheme()).toBe('dark');
  });
});
