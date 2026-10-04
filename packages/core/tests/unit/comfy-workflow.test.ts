// 018 · FR-003 — workflow JSON ComfyUI (D4 9.2): thay chỗ trống, chọn chế độ, ảnh tham chiếu, alpha.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attachImages,
  buildQwenWorkflow,
  fillWorkflow,
  keepAlpha,
  loadWorkflow,
  qwenMode,
  snapSide,
  type ComfyWorkflow,
} from '../../src/index.js';
import { EXTENSIONS_DIR } from '../../src/agent/options.js';

const PACK = path.join(EXTENSIONS_DIR, 'providers', 'image.qwen21-comfy');
const DEFAULTS = {
  unet: 'u.gguf',
  clip: 'c.safetensors',
  vae: 'v.safetensors',
  steps: 15,
  cfg: 1,
  sampler: 'euler',
  scheduler: 'simple',
};
const byClass = (wf: ComfyWorkflow, c: string) =>
  Object.values(wf).filter((n) => n.class_type === c);

describe('fillWorkflow (018)', () => {
  it('whole-string placeholders take typed values; embedded ones are text', () => {
    const wf = fillWorkflow(loadWorkflow(PACK, 't2i_rgba'), {
      ...DEFAULTS,
      prompt: 'Đèn lồng "đỏ"\nmột dòng',
      negative: '',
      width: 1024,
      height: 768,
      seed: 42,
    });
    expect(byClass(wf, 'EmptyLatentImage')[0]!.inputs).toMatchObject({ width: 1024, height: 768 });
    expect(byClass(wf, 'KSampler')[0]!.inputs).toMatchObject({ seed: 42, steps: 15, cfg: 1 });
    const enc = byClass(wf, 'TextEncodeQwenImage21')[0]!.inputs;
    expect(enc.prompt).toBe(
      'This is an RGBA image with transparency. Đèn lồng "đỏ"\nmột dòng The image has alpha channel and the background is transparent.',
    );
    expect(JSON.stringify(wf)).not.toContain('{{');
  });

  it('unknown or missing placeholder → E_SCHEMA_INVALID', () => {
    expect(() => fillWorkflow({ 1: { class_type: 'X', inputs: { a: '{{nope}}' } } }, {})).toThrow(
      /nope/,
    );
  });
});

describe('qwen workflow (018)', () => {
  it('mode from the request', () => {
    expect(qwenMode({ kind: 'generate' })).toBe('t2i');
    expect(qwenMode({ kind: 'generate', transparent: true })).toBe('t2i_rgba');
    expect(qwenMode({ kind: 'edit' })).toBe('edit_ref');
    expect(qwenMode({ kind: 'edit', mask: true })).toBe('edit_mask');
  });

  it('sizes snap to multiples of 32 within the provider limits', () => {
    expect(snapSide(1000, { min: 256, max: 2048 })).toBe(992);
    expect(snapSide(1664, { min: 256, max: 2048 })).toBe(1664);
    expect(() => snapSide(100, { min: 256, max: 2048 })).toThrow(/256/);
    expect(() => snapSide(4096, { min: 256, max: 2048 })).toThrow(/2048/);
  });

  it('opaque modes drop alpha; keepAlpha saves the decoded RGBA', () => {
    const wf = loadWorkflow(PACK, 'edit_ref');
    expect(byClass(wf, 'SplitImageWithAlpha')).toHaveLength(1);
    const kept = keepAlpha(wf);
    const save = byClass(kept, 'SaveImage')[0]!.inputs.images as [string, number];
    expect(kept[save[0]]!.class_type).toBe('VAEDecode');
    expect(byClass(loadWorkflow(PACK, 't2i_rgba'), 'SplitImageWithAlpha')).toHaveLength(0);
  });

  it('reference images become LoadImage nodes wired into the encoder (with the VAE)', () => {
    const wf = attachImages(loadWorkflow(PACK, 't2i'), ['a.png', 'b.png']);
    const loads = byClass(wf, 'LoadImage').map((n) => n.inputs.image);
    expect(loads).toEqual(['a.png', 'b.png']);
    const enc = byClass(wf, 'TextEncodeQwenImage21')[0]!.inputs;
    expect(enc['images.image_1']).toBeDefined();
    expect(enc['images.image_2']).toBeDefined();
    expect(enc.vae).toEqual(['3', 0]);
    // edit đã có image_1 (ảnh nguồn) → tham chiếu bắt đầu từ chỗ trống tiếp theo
    const e = attachImages(loadWorkflow(PACK, 'edit_mask'), ['r.png']);
    expect(Object.keys(byClass(e, 'TextEncodeQwenImage21')[0]!.inputs)).toContain('images.image_3');
  });

  it('buildQwenWorkflow fills a full edit request', () => {
    const wf = buildQwenWorkflow(PACK, DEFAULTS, {
      mode: 'edit_mask',
      prompt: 'đổi trời thành hoàng hôn',
      seed: 7,
      image_in: 'src.png',
      mask_in: 'mask.png',
      refs: [],
    });
    expect(byClass(wf, 'LoadImage').map((n) => n.inputs.image)).toEqual(['src.png', 'mask.png']);
    expect(byClass(wf, 'KSampler')[0]!.inputs.seed).toBe(7);
    expect(JSON.stringify(wf)).not.toContain('{{');
  });
});
