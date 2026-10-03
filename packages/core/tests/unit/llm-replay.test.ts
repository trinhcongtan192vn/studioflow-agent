// 001 · US5 AC3 · FR-SC-013 — SF_LLM record/replay (D12 mục 2).
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmCall, requestKey } from '../../src/testing/llm-replay.js';
import { gpuEnabled } from '../../src/testing/gpu.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'llm-'));
  dirs.push(d);
  return d;
}

describe('LLM record/replay (001 FR-SC-013)', () => {
  it('replay with no fixture fails and never calls the real LLM', async () => {
    const real = vi.fn();
    await expect(
      llmCall({ prompt: 'x' }, real, { mode: 'replay', fixtureDir: tmp() }),
    ).rejects.toMatchObject({ code: 'E_LLM_FIXTURE_MISSING' });
    expect(real).not.toHaveBeenCalled();
  });

  it('record writes a fixture that replay then reads', async () => {
    const dir = tmp();
    const real = vi.fn(async () => ({ text: 'hello' }));
    expect(await llmCall({ prompt: 'x' }, real, { mode: 'record', fixtureDir: dir })).toEqual({
      text: 'hello',
    });
    expect(readdirSync(dir)).toHaveLength(1);
    const again = vi.fn();
    expect(await llmCall({ prompt: 'x' }, again, { mode: 'replay', fixtureDir: dir })).toEqual({
      text: 'hello',
    });
    expect(again).not.toHaveBeenCalled();
  });

  it('request key is stable regardless of property order', () => {
    expect(requestKey({ a: 1, b: { c: 2, d: [3, { e: 4, f: 5 }] } })).toBe(
      requestKey({ b: { d: [3, { f: 5, e: 4 }], c: 2 }, a: 1 }),
    );
  });

  it('defaults to replay when SF_LLM is unset; rejects unknown modes', async () => {
    const prev = process.env.SF_LLM;
    delete process.env.SF_LLM;
    try {
      await expect(llmCall({ p: 1 }, vi.fn(), { fixtureDir: tmp() })).rejects.toMatchObject({
        code: 'E_LLM_FIXTURE_MISSING',
      });
      process.env.SF_LLM = 'live';
      await expect(llmCall({ p: 1 }, vi.fn(), { fixtureDir: tmp() })).rejects.toMatchObject({
        code: 'E_LLM_MODE',
      });
    } finally {
      if (prev === undefined) delete process.env.SF_LLM;
      else process.env.SF_LLM = prev;
    }
  });
});

describe('gpuEnabled (001 FR-SC-013)', () => {
  it('is false only when SF_GPU=0', () => {
    const prev = process.env.SF_GPU;
    try {
      process.env.SF_GPU = '0';
      expect(gpuEnabled()).toBe(false);
      process.env.SF_GPU = '1';
      expect(gpuEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SF_GPU;
      else process.env.SF_GPU = prev;
    }
  });
});
