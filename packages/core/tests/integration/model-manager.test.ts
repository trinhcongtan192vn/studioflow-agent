// 014 · FR-OP-04, FR-OP-07 — danh mục, tải (tiếp khi đứt, sha256), cài thành phần, settings.installed,
// Credential Manager thật (Windows).
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  bsdtar,
  downloadFile,
  installEntry,
  installPlan,
  loadCatalog,
  secretDelete,
  secretGet,
  secretHint,
  secretSet,
  validateArtifact,
  type CatalogEntry,
} from '../../src/index.js';
import { tempDir } from '../domain-helpers.js';

const blob = randomBytes(3 * 1024 * 1024);
const sha = createHash('sha256').update(blob).digest('hex');
let zip: Buffer;
let base = '';
let cutOnce = true;
let server: http.Server;
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

beforeAll(async () => {
  const t = tempDir('zip-');
  writeFileSync(path.join(t.dir, 'tool.exe'), 'fake exe');
  spawnSync(bsdtar(), ['-a', '-cf', path.join(t.dir, 'tool.zip'), '-C', t.dir, 'tool.exe']);
  zip = readFileSync(path.join(t.dir, 'tool.zip'));
  t.cleanup();
  server = http.createServer((req, res) => {
    const body = req.url === '/tool.zip' ? zip : blob;
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    const start = m ? Number(m[1]) : 0;
    res.writeHead(m ? 206 : 200, {
      'content-length': body.length - start,
      'accept-ranges': 'bytes',
    });
    if (req.url === '/blob' && cutOnce && !m) {
      // lần đầu: đứt kết nối sau 1 MB
      cutOnce = false;
      res.write(body.subarray(0, 1024 * 1024), () => res.destroy());
      return;
    }
    res.end(body.subarray(start));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('catalog (014)', () => {
  it('every entry is pinned with url + sha256 + size; standard plan lists components', () => {
    const c = loadCatalog();
    expect(c.map((e) => e.key)).toEqual(
      expect.arrayContaining([
        'ffmpeg',
        'uv',
        'whisper-cli',
        'whisper-large-v3-turbo',
        'omnivoice-model',
        'omnivoice-env',
        'audio-analysis-env',
      ]),
    );
    const t = tempDir('app-');
    cleanups.push(t.cleanup);
    const plan = installPlan(t.dir, 'standard', c);
    const model = plan.entries.find((e) => e.key === 'whisper-large-v3-turbo')!;
    expect(model).toMatchObject({ status: 'missing', bytes: 1624555275 });
    expect(plan.total_bytes).toBeGreaterThan(5e9);
    expect(installPlan(t.dir, 'minimal', c).entries.map((e) => e.key)).toEqual(['ffmpeg']);
  });
});

describe('download (014 FR-OP-04)', () => {
  it('resumes after a dropped connection and verifies sha256', async () => {
    const t = tempDir('dl-');
    cleanups.push(t.cleanup);
    const dest = path.join(t.dir, 'm', 'blob.bin');
    const seen: number[] = [];
    const r = await downloadFile(`${base}/blob`, dest, {
      sha256: sha,
      size: blob.length,
      progress: (d) => seen.push(d),
    });
    expect(r.skipped).toBe(false);
    expect(readFileSync(dest).equals(blob)).toBe(true);
    expect(existsSync(`${dest}.part`)).toBe(false);
    expect(Math.min(...seen.filter((x) => x > 0))).toBeLessThanOrEqual(1024 * 1024);
    // đã có đúng file → bỏ qua
    expect(
      (await downloadFile(`${base}/blob`, dest, { sha256: sha, size: blob.length })).skipped,
    ).toBe(true);
  });

  it('a checksum mismatch never leaves a file at the destination', async () => {
    const t = tempDir('dl-');
    cleanups.push(t.cleanup);
    const dest = path.join(t.dir, 'bad.bin');
    await expect(
      downloadFile(`${base}/blob2`, dest, { sha256: 'f'.repeat(64), size: blob.length }),
    ).rejects.toMatchObject({ code: 'E_DOWNLOAD_CHECKSUM' });
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it('installs a component (zip extract + small text file) and records settings.installed', async () => {
    const t = tempDir('app-');
    cleanups.push(t.cleanup);
    const catalog: CatalogEntry[] = [
      {
        key: 'tool',
        title: 'Tool 1.0',
        install_profile: 'standard',
        files: [
          {
            name: 'tool.zip',
            url: `${base}/tool.zip`,
            sha256: createHash('sha256').update(zip).digest('hex'),
            size: zip.length,
            dest: 'providers/tool/tool.zip',
            extract: 'providers/tool/bin',
          },
          { name: 'ref', content: 'abc', dest: 'providers/tool/ref' },
        ],
      },
    ];
    expect(installPlan(t.dir, 'standard', catalog).entries[0]).toMatchObject({
      status: 'missing',
      bytes: zip.length,
    });
    const st = await installEntry(t.dir, 'tool', { catalog, profile: 'standard' });
    expect(st.status).toBe('installed');
    expect(readFileSync(path.join(t.dir, 'providers', 'tool', 'bin', 'tool.exe'), 'utf8')).toBe(
      'fake exe',
    );
    const settings = readFileSync(path.join(t.dir, 'settings.json'), 'utf8');
    expect(validateArtifact('settings.json', settings).errors).toEqual([]);
    expect(JSON.parse(settings).installed).toMatchObject({
      profile: 'standard',
      components: [{ id: 'tool', version: 'Tool 1.0' }],
    });
    await expect(installEntry(t.dir, 'nope', { catalog })).rejects.toMatchObject({
      code: 'E_ID_UNKNOWN',
    });
  });
});

describe.skipIf(process.platform !== 'win32')('Credential Manager (014 FR-OP-07)', () => {
  it('stores, reads (hint only last 4) and deletes a key', () => {
    const name = `test-${randomBytes(4).toString('hex')}`;
    try {
      secretSet(name, 'sk-test-ABCD1234');
      expect(secretGet(name)).toBe('sk-test-ABCD1234');
      expect(secretHint(name)).toBe('…1234');
    } finally {
      expect(secretDelete(name)).toBe(true);
    }
    expect(secretGet(name)).toBeUndefined();
  }, 60_000);
});
