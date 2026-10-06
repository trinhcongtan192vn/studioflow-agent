// 037 — tiến trình con chạy bằng execPath: trong Electron phải chạy như Node.
import { expect, it } from 'vitest';
import { nodeChildEnv } from '../../src/node-child.js';

it('adds ELECTRON_RUN_AS_NODE only when running inside Electron', () => {
  expect(nodeChildEnv({ A: '1' }, true)).toEqual({ A: '1', ELECTRON_RUN_AS_NODE: '1' });
  expect(nodeChildEnv({ A: '1' }, false)).toEqual({ A: '1' });
});
