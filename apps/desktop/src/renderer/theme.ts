/** 067: giao diện Tối (mặc định) / Sáng / Theo Windows — nhớ theo máy, đặt `data-theme` trên <html>. */
export type Theme = 'dark' | 'light' | 'system';
const KEY = 'sf.theme';

export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* không lưu được → lần sau về mặc định tối */
  }
}
