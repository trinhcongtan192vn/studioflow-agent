// 037 — kết quả `hyperframes check`: quá thời gian báo rõ; JSON `ok` quyết định khi có; thời gian chờ theo số frame.
import { describe, expect, it } from 'vitest';
import { checkTimeoutMs, checkVerdict } from '../../src/hf/cli.js';

describe('checkVerdict', () => {
  it('a timeout is reported as such (not an empty failure)', () => {
    expect(() =>
      checkVerdict({ code: null, stdout: '', stderr: '', timedOut: true }, 900_000),
    ).toThrow(/timed out after 15 min/);
  });
  it('JSON ok with no errors passes even when the exit code is odd', () => {
    expect(
      checkVerdict(
        {
          code: 1,
          stdout: '',
          stderr: '',
          json: { ok: true, lint: { errorCount: 0, findings: [] } },
        },
        1,
      ),
    ).toMatchObject({ ok: true, errorCount: 0 });
  });
  it('error findings fail with the findings listed', () => {
    const r = checkVerdict(
      {
        code: 1,
        stdout: '',
        stderr: '',
        json: {
          ok: false,
          lint: { errorCount: 1, findings: [{ severity: 'error', code: 'x', message: 'bad' }] },
        },
      },
      1,
    );
    expect(r).toMatchObject({ ok: false, errorCount: 1, errors: [{ code: 'x', pass: 'lint' }] });
  });
});

describe('checkTimeoutMs', () => {
  it('grows with the number of frames, at least 10 minutes', () => {
    expect(checkTimeoutMs(5)).toBe(600_000);
    expect(checkTimeoutMs(46)).toBe(46 * 30_000);
  });
});
