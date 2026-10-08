// 092 · FR-UI-92-03 — đổi tùy chọn Nâng cao: gợi ý chạy lại từ bước sớm nhất chịu ảnh hưởng đã chạy.
import { describe, expect, it } from 'vitest';
import { changedHint, rerunHint } from '../../src/renderer/advanced-format';

const steps = (st: Record<string, string>) =>
  [
    ['design', 'design-system', 'Design system'],
    ['script', 'script', 'Kịch bản'],
    ['storyboard', 'storyboard', 'Storyboard'],
    ['voice', 'voice', 'Giọng đọc'],
    ['frames', 'frame-build', 'Dựng frame'],
    ['music', 'music', 'Nhạc nền'],
    ['finalize', 'finalize', 'Hoàn thiện'],
    ['meta', 'publish-meta', 'Tiêu đề, mô tả, chương'],
    ['render', 'render', 'Render phát hành'],
  ].map(([id, uses, title]) => ({
    id: id!,
    uses: uses!,
    title: title!,
    status: st[id!] ?? 'done',
  }));

describe('rerunHint (092)', () => {
  it('music: rerun from the music step; later steps are counted', () => {
    const h = rerunHint('advanced.music', steps({}))!;
    expect(h.primary).toEqual({ step: 'music', label: '↻ Chạy lại từ "Nhạc nền"' });
    expect(h.text).toMatch(/3 bước sau/);
    expect(h.secondary).toBeUndefined();
  });

  it('custom frames: rerun from frame building', () => {
    expect(rerunHint('advanced.custom_frames', steps({}))!.primary!.step).toBe('frames');
  });

  it('refine / reasoning: earliest text step, plus a cheaper title-only option', () => {
    for (const k of ['advanced.refine', 'advanced.reasoning'] as const) {
      const h = rerunHint(k, steps({}))!;
      expect(h.primary!.step).toBe('script');
      expect(h.secondary).toEqual({ step: 'meta', label: 'Chỉ làm lại "Tiêu đề, mô tả, chương"' });
    }
  });

  it('a step that has not run yet: applies by itself, no button', () => {
    const h = rerunHint(
      'advanced.music',
      steps({ music: 'pending', finalize: 'pending', meta: 'pending', render: 'pending' }),
    )!;
    expect(h.primary).toBeUndefined();
    expect(h.text).toMatch(/Sẽ áp dụng khi chạy tới bước "Nhạc nền"/);
  });

  it('a skipped step counts as run (music was off, now on)', () => {
    expect(rerunHint('advanced.music', steps({ music: 'skipped' }))!.primary!.step).toBe('music');
  });

  it('a workflow without an affected step → no hint', () => {
    expect(
      rerunHint('advanced.music', [{ id: 'a', uses: 'script', title: 'A', status: 'done' }]),
    ).toBeNull();
  });
});

describe('changedHint (092)', () => {
  it('several changed options → the earliest step wins; labels are listed', () => {
    const h = changedHint(['advanced.music', 'advanced.reasoning'], steps({}))!;
    expect(h.title).toBe('Đã đổi: Nhạc nền, Model mạnh (reasoning)');
    expect(h.primary!.step).toBe('script');
    // nút phụ "chỉ tiêu đề" không đủ khi còn tùy chọn khác cần chạy lại sớm hơn
    expect(h.secondary).toBeUndefined();
    expect(changedHint([], steps({}))).toBeNull();
    expect(changedHint(['advanced.refine'], steps({}))!.secondary!.step).toBe('meta');
  });
});
