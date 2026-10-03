// 003 · US4 · FR-017 — script.run (D5 mục 5.2).
import { afterEach, describe, expect, it } from 'vitest';
import { setScriptExecutable } from '../../src/index.js';
import { gatewayFixture, type GatewayFixture } from '../gateway-helpers.js';

let fx: GatewayFixture;
afterEach(() => {
  fx?.cleanup();
  setScriptExecutable('hyperframes', undefined);
});

describe('script.run (003 US4)', () => {
  it('runs an agent-allowed sf command in the video dir', async () => {
    fx = gatewayFixture();
    const r = await fx.gw.call(fx.session(), 'script.run', {
      command: 'sf',
      args: ['artifact', 'validate', 'SCRIPT.md'],
    });
    expect(r).toMatchObject({
      ok: true,
      data: { exit_code: 0, truncated: false, timed_out: false },
    });
    expect(JSON.parse((r as { data: { stdout: string } }).data.stdout)).toMatchObject({
      valid: true,
      kind: 'script',
    });
  });

  it('non-agent sf commands are denied', async () => {
    fx = gatewayFixture();
    for (const args of [
      ['artifact', 'migrate', '.'],
      ['gateway', 'serve'],
      ['test', 'unit'],
      ['diag', 'echo'],
    ]) {
      expect(
        await fx.gw.call(fx.session(), 'script.run', { command: 'sf', args }),
        args.join(' '),
      ).toMatchObject({
        ok: false,
        error: { code: 'E_SCRIPT_DENIED' },
      });
    }
  });

  it('commands outside the allow-list are denied', async () => {
    fx = gatewayFixture();
    for (const command of [
      'powershell',
      'cmd',
      'node',
      'git',
      'C:/Windows/System32/cmd.exe',
      'bash',
    ]) {
      expect(
        await fx.gw.call(fx.session(), 'script.run', { command, args: [] }),
        command,
      ).toMatchObject({
        ok: false,
        error: { code: 'E_SCRIPT_DENIED' },
      });
    }
  });

  it('dangerous arguments are denied', async () => {
    fx = gatewayFixture();
    for (const a of [
      '..\\x',
      '../x',
      'C:\\Windows',
      '/etc/passwd',
      'a|b',
      '$(x)',
      ';rm',
      'a&b',
      'a>b',
      'a`b',
      'a\nb',
    ]) {
      expect(
        await fx.gw.call(fx.session(), 'script.run', {
          command: 'sf',
          args: ['artifact', 'validate', a],
        }),
        a,
      ).toMatchObject({
        ok: false,
        error: { code: 'E_SCRIPT_DENIED' },
      });
    }
  });

  it('missing executables are reported, not hung', async () => {
    fx = gatewayFixture();
    expect(
      await fx.gw.call(fx.session(), 'script.run', {
        command: 'hyperframes',
        args: ['lint', 'index.html'],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'E_SCRIPT_NOT_FOUND' },
    });
  });

  it('frame sessions may only lint/check/snapshot their own frame', async () => {
    fx = gatewayFixture();
    setScriptExecutable('hyperframes', {
      cmd: process.execPath,
      prefix: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--'],
    });
    const s = fx.session({
      kind: 'frame',
      frame_id: 'fr_9x2b7cqe',
      allowed_paths: ['compositions/frames/fr_9x2b7cqe.html'],
    });
    const ok = await fx.gw.call(s, 'script.run', {
      command: 'hyperframes',
      args: ['lint', 'compositions/frames/fr_9x2b7cqe.html'],
    });
    expect(ok).toMatchObject({ ok: true, data: { exit_code: 0 } });
    expect(JSON.parse((ok as { data: { stdout: string } }).data.stdout)).toEqual([
      'lint',
      'compositions/frames/fr_9x2b7cqe.html',
    ]);
    for (const args of [
      ['lint', 'compositions/frames/fr_3m8k1w7d.html'],
      ['add', 'x'],
      ['lint', 'index.html'],
    ]) {
      expect(
        await fx.gw.call(s, 'script.run', { command: 'hyperframes', args }),
        args.join(' '),
      ).toMatchObject({
        ok: false,
        error: { code: 'E_SCRIPT_DENIED' },
      });
    }
    expect(
      await fx.gw.call(s, 'script.run', {
        command: 'sf',
        args: ['artifact', 'validate', 'SCRIPT.md'],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'E_SCRIPT_DENIED' },
    });
  });

  it('hyperframes sub-commands follow D5 5.2 argument rules', async () => {
    fx = gatewayFixture();
    setScriptExecutable('hyperframes', { cmd: process.execPath, prefix: ['-e', '', '--'] });
    const run = (args: string[]) =>
      fx.gw.call(fx.session(), 'script.run', { command: 'hyperframes', args });
    expect(await run(['catalog', 'list'])).toMatchObject({ ok: true });
    expect(await run(['catalog', 'delete'])).toMatchObject({
      ok: false,
      error: { code: 'E_SCRIPT_DENIED' },
    });
    expect(await run(['snapshot', 'index.html', '--out', '.sf/snapshots/a.png'])).toMatchObject({
      ok: true,
    });
    expect(await run(['snapshot', 'index.html', '--out', 'public/a.png'])).toMatchObject({
      ok: false,
      error: { code: 'E_SCRIPT_DENIED' },
    });
    expect(await run(['media-treatment', '--dry-run', 'public/a.png'])).toMatchObject({ ok: true });
    expect(await run(['render', 'x'])).toMatchObject({
      ok: false,
      error: { code: 'E_SCRIPT_DENIED' },
    });
  });

  it('child gets a minimal env with a blocking proxy and no secrets', async () => {
    fx = gatewayFixture();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-should-not-leak';
    try {
      setScriptExecutable('hyperframes', {
        cmd: process.execPath,
        prefix: ['-e', 'process.stdout.write(JSON.stringify(process.env))', '--'],
      });
      const r = await fx.gw.call(fx.session(), 'script.run', {
        command: 'hyperframes',
        args: ['catalog', 'list'],
      });
      const env = JSON.parse((r as { data: { stdout: string } }).data.stdout) as Record<
        string,
        string
      >;
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.HTTP_PROXY).toBe('http://127.0.0.1:9');
      expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:9');
      // Ngoài danh sách tối thiểu, Windows/libuv luôn thêm các biến hệ thống không bí mật.
      const allowed = new Set(
        [
          'SystemRoot',
          'windir',
          'PATH',
          'HTTP_PROXY',
          'HTTPS_PROXY',
          'NO_PROXY',
          'TEMP',
          'TMP',
          'APPDATA',
          'LOCALAPPDATA',
          'SF_GPU',
          'SF_LLM',
          'HOMEDRIVE',
          'HOMEPATH',
          'LOGONSERVER',
          'SYSTEMDRIVE',
          'USERDOMAIN',
          'USERNAME',
          'USERPROFILE',
        ].map((k) => k.toUpperCase()),
      );
      expect(Object.keys(env).filter((k) => !allowed.has(k.toUpperCase()))).toEqual([]);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('times out and truncates output', async () => {
    fx = gatewayFixture();
    setScriptExecutable('hyperframes', {
      cmd: process.execPath,
      prefix: ['-e', 'setInterval(() => {}, 1000)', '--'],
    });
    const slow = await fx.gw.call(
      fx.session(),
      'script.run',
      { command: 'hyperframes', args: ['catalog', 'list'] },
      { scriptTimeoutMs: 300 },
    );
    expect(slow).toMatchObject({ ok: true, data: { timed_out: true } });
    setScriptExecutable('hyperframes', {
      cmd: process.execPath,
      prefix: ['-e', 'process.stdout.write("x".repeat(3*1024*1024))', '--'],
    });
    const big = await fx.gw.call(fx.session(), 'script.run', {
      command: 'hyperframes',
      args: ['catalog', 'list'],
    });
    expect(big).toMatchObject({ ok: true, data: { truncated: true } });
    expect((big as { data: { stdout: string } }).data.stdout.length).toBe(1024 * 1024);
  });
});
