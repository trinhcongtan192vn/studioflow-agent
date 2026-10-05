// 008 · FR-VO-01 — bước `voice` thiếu giọng: một lỗi gọn, nêu người nói thiếu và cách tạo giọng (thay vì lỗi từng line).
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { speakersWithoutVoice } from '../../src/workflow/cast.js';

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/domain/channel',
);
let tmp = '';
afterEach(() => tmp && rmSync(tmp, { recursive: true, force: true }));

function channel(withVoice: boolean): string {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'sf-vo-'));
  const dir = path.join(tmp, 'ch');
  cpSync(fixture, dir, { recursive: true });
  if (!withVoice) {
    const f = path.join(dir, 'channel.json');
    const c = JSON.parse(readFileSync(f, 'utf8'));
    delete c.config['voice.id'];
    writeFileSync(f, JSON.stringify(c, null, 2));
  }
  return dir;
}

describe('speakersWithoutVoice', () => {
  it('lists the narrator once when voice.id is not set', () => {
    expect(speakersWithoutVoice(channel(false), 'vd_8m2pq7rt')).toContain('narrator');
  });
  it('is empty for the narrator when voice.id is set', () => {
    expect(speakersWithoutVoice(channel(true), 'vd_8m2pq7rt')).not.toContain('narrator');
  });
});
