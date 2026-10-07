// 045 — app tắt khi phiên Studio (sửa) còn mở: `owner = studio` sót lại chặn mọi lần ghi frame
// (E_OWNER_CONFLICT). Mở lại video → nhả khóa; bản làm việc có thay đổi chưa commit thì giữ lại.
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { sha256 } from '../../src/domain/hash.js';
import { StudioEdits } from '../../src/studio/edit.js';
import { workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture;
afterEach(() => fx?.cleanup());

function strand(f: WorkflowFixture, work: string, edited: boolean) {
  const html = '<!doctype html><html><body><div data-sf-id="el_aaaaaaaa">A</div></body></html>\n';
  f.store.write(f.v('compositions/frames/fr_x.html'), html, { by: 'test', validate: false });
  f.store.write(
    `${work}/compositions/frames/fr_x.html`,
    edited ? html.replace('>A<', '>B (sửa trong Studio)<') : html,
    { by: 'test', validate: false },
  );
  f.store.write(
    `${work}/base.json`,
    JSON.stringify({ 'compositions/frames/fr_x.html': sha256(html) }),
    { by: 'test', validate: false },
  );
  const p = f.v('state.json');
  const st = JSON.parse(readFileSync(f.store.abs(p), 'utf8'));
  st.owner = 'studio';
  st.owner_since = '2026-10-06T15:14:42.177Z';
  f.store.write(p, `${JSON.stringify(st, null, 2)}\n`, { by: 'test' });
}
const owner = (f: WorkflowFixture) =>
  JSON.parse(readFileSync(f.store.abs(f.v('state.json')), 'utf8')).owner;

it('a leftover Studio lock without a live session is released; an unchanged work copy is removed', () => {
  fx = workflowFixture();
  const work = fx.v('.sf/studio-work/ss_old00001');
  strand(fx, work, false);
  const r = new StudioEdits({}).recoverStale(fx.store, fx.videoId);
  expect(r).toEqual({ released: true, kept: [] });
  expect(owner(fx)).toBe('agent');
  expect(existsSync(fx.store.abs(work))).toBe(false);
});

it('uncommitted Studio edits are kept (lock still released) and reported', () => {
  fx = workflowFixture();
  const work = fx.v('.sf/studio-work/ss_old00002');
  strand(fx, work, true);
  const r = new StudioEdits({}).recoverStale(fx.store, fx.videoId);
  expect(r).toEqual({
    released: true,
    kept: [{ work, files: ['compositions/frames/fr_x.html'] }],
  });
  expect(owner(fx)).toBe('agent');
  expect(existsSync(fx.store.abs(`${work}/compositions/frames/fr_x.html`))).toBe(true);
});

it('nothing to do when the agent owns the video', () => {
  fx = workflowFixture();
  expect(new StudioEdits({}).recoverStale(fx.store, fx.videoId)).toEqual({
    released: false,
    kept: [],
  });
});
