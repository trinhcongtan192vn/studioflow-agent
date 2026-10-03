// 009 · US5 · FR-006 — kiểm khách quan D6 4.2.
import { describe, expect, it } from 'vitest';
import { checkMeta, checkScript } from '../../src/index.js';
import { fixtureAppData, fixtureChannel, fixtureVideoId } from '../domain-helpers.js';

const fm = '---\nschema_version: 1\nvideo_id: vd_8m2pq7rt\nlanguage: vi\nstatus: draft\n---\n';
const ctx = (over: object = {}) => ({
  channelDir: fixtureChannel,
  videoId: fixtureVideoId,
  appDataDir: fixtureAppData,
  targetDurationMs: 6000,
  banned: ['tuyệt vời nhất'],
  ...over,
});
const words = (n: number) => Array.from({ length: n }, () => 'chữ').join(' ');
const script = (body: string) => `${fm}## A <!-- sf:beat id=bt_aaaaaaaa -->\n\n${body}`;
const line = (id: string, text: string, extra = '') =>
  `<!-- sf:line id=${id} speaker=narrator${extra} -->\n${text}\n\n`;

describe('checkScript (009 US5)', () => {
  it('passes a script on target (150 wpm → 15 words for 6 s)', () => {
    const r = checkScript(script(line('ln_aaaaaaaa', words(15))), ctx());
    expect(Object.fromEntries(r.map((x) => [x.id, x.pass]))).toEqual({
      schema: true,
      length: true,
      read_time: true,
      beat_structure: true,
      banned_terms: true,
      tts_normalized: true,
    });
  });

  it('length/read_time fail outside tolerance', () => {
    const r = checkScript(script(line('ln_aaaaaaaa', words(40))), ctx());
    expect(r.find((x) => x.id === 'length')).toMatchObject({
      pass: false,
      detail: expect.stringContaining('40'),
    });
    expect(r.find((x) => x.id === 'read_time')!.pass).toBe(false);
  });

  it('banned terms, digits without tts, empty beats, broken schema', () => {
    const body =
      line('ln_aaaaaaaa', 'Đây là điều tuyệt vời nhất năm 1428') +
      '## B <!-- sf:beat id=bt_bbbbbbbb -->\n\n';
    const r = Object.fromEntries(checkScript(script(body), ctx()).map((x) => [x.id, x]));
    expect(r.banned_terms).toMatchObject({
      pass: false,
      detail: expect.stringContaining('tuyệt vời nhất'),
    });
    expect(r.tts_normalized).toMatchObject({
      pass: false,
      detail: expect.stringContaining('ln_aaaaaaaa'),
    });
    expect(r.beat_structure).toMatchObject({
      pass: false,
      detail: expect.stringContaining('bt_bbbbbbbb'),
    });
    const okTts = line('ln_aaaaaaaa', 'Năm 1428', '').replace(
      'Năm 1428\n',
      'Năm 1428\n<!-- sf:tts text="Năm một nghìn bốn trăm hai mươi tám" -->\n',
    );
    expect(checkScript(script(okTts), ctx()).find((x) => x.id === 'tts_normalized')!.pass).toBe(
      true,
    );
    expect(checkScript('không phải kịch bản', ctx()).find((x) => x.id === 'schema')!.pass).toBe(
      false,
    );
  });

  it('beat range from the pack when given', () => {
    const r = checkScript(
      script(line('ln_aaaaaaaa', words(15))),
      ctx({ beats: { min: 5, max: 9 } }),
    );
    expect(r.find((x) => x.id === 'beat_structure')).toMatchObject({
      pass: false,
      detail: expect.stringContaining('5'),
    });
  });

  it('no target duration → length/read_time pass with a note', () => {
    const r = checkScript(script(line('ln_aaaaaaaa', words(15))), ctx({ targetDurationMs: null }));
    expect(r.find((x) => x.id === 'length')).toMatchObject({
      pass: true,
      detail: expect.stringContaining('no target'),
    });
  });
});

describe('checkMeta (009 US5)', () => {
  it('title and description limits', () => {
    expect(checkMeta({ title: 'x'.repeat(101), description: 'ok', tags: [] }, ctx())).toEqual([
      expect.objectContaining({ id: 'meta_limits', pass: false }),
      expect.objectContaining({ id: 'banned_terms', pass: true }),
    ]);
    expect(
      checkMeta({ title: 'Ổn', description: 'tuyệt vời nhất', tags: [] }, ctx())[1]!.pass,
    ).toBe(false);
  });
});
