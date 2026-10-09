// 007 FR-WF-03 — quay lại bước khi state.json chưa có đủ các bước sau (video cũ/khôi phục) không lỗi.
import { copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { createCore } from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

it('rewind re-runs the step when later steps are missing from state.json', async () => {
  const c = copyChannel();
  const t = tempDir('app-');
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const core = createCore({ appDataDir: t.dir, start: false });
  cleanups.push(() => core.close(), c.cleanup, t.cleanup);
  const e = core.workflows.engine(c.dir, fixtureVideoId);
  await e.rewind('script');
  await e.idle();
  const st = JSON.parse(
    readFileSync(path.join(c.dir, 'videos', fixtureVideoId, 'state.json'), 'utf8'),
  ) as { steps: Record<string, { status: string; attempt: number; error?: { code: string } }> };
  // quay lại → bước chạy lại ngay (lần chạy thứ 2); các bước sau có mặt, chưa chạy.
  // 093: test không có bản ghi LLM nên lần chạy lại lỗi — và giữ trạng thái lỗi (không thành "chờ duyệt")
  expect(st.steps.script!.attempt).toBe(2);
  expect(st.steps.script!.status).toBe('failed');
  expect(st.steps.script!.error!.code).toBe('E_LLM_FIXTURE_MISSING');
  expect(Object.keys(st.steps).length).toBeGreaterThan(1);
});
