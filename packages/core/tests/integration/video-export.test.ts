// 066 — xuất video ra thư mục người dùng chọn (constitution 1.2, Điều VI ngoại lệ): chỉ sao chép, không ghi đè.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportVideo, listRenders, renderLibrary, safeFileName } from '../../src/render/export.js';
import { createVideo } from '../../src/domain/video.js';
import { WriteStore } from '../../src/store/writer.js';
import { copyChannel, tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function setup() {
  const c = copyChannel();
  const out = tempDir('sf-export-');
  cleanups.push(c.cleanup, out.cleanup);
  const store = new WriteStore(c.dir);
  const { video_id } = createVideo(store, { title: 'Lốc xoáy: vì sao?' });
  const v = `videos/${video_id}`;
  const w = (rel: string, content: string | Buffer) =>
    store.write(`${v}/${rel}`, content, { by: 'test', validate: false });
  const render = (id: string, mode: 'draft' | 'release', finished: string, bytes: string) => {
    w(
      `renders/${id}/render.json`,
      JSON.stringify({
        schema_version: 1,
        id,
        mode,
        output_profile: 'yt-1080p30',
        status: 'done',
        file: `renders/${id}/video.mp4`,
        duration_ms: 1000,
        started_at: finished,
        finished_at: finished,
      }),
    );
    w(`renders/${id}/video.mp4`, Buffer.from(bytes));
  };
  return { dir: c.dir, out: out.dir, store, video: video_id, w, render };
}

describe('video export (066)', () => {
  it('lists finished renders newest first', () => {
    const s = setup();
    s.render('rd_aaaaaaaa', 'draft', '2026-10-08T01:00:00.000Z', 'nháp');
    s.render('rd_bbbbbbbb', 'release', '2026-10-08T02:00:00.000Z', 'phát hành');
    s.w(
      'renders/rd_cccccccc/render.json',
      JSON.stringify({ id: 'rd_cccccccc', mode: 'release', status: 'failed' }),
    );
    expect(listRenders(s.dir, s.video).map((r) => [r.render_id, r.mode])).toEqual([
      ['rd_bbbbbbbb', 'release'],
      ['rd_aaaaaaaa', 'draft'],
    ]);
  });

  it('copies the latest release render as <title>.mp4; the project is untouched', () => {
    const s = setup();
    s.render('rd_aaaaaaaa', 'draft', '2026-10-08T03:00:00.000Z', 'nháp');
    s.render('rd_bbbbbbbb', 'release', '2026-10-08T02:00:00.000Z', 'phát hành');
    const r = exportVideo({ channel: s.dir, video: s.video, dest_dir: s.out });
    expect(r.files).toEqual([path.join(s.out, 'Lốc xoáy vì sao.mp4')]);
    expect(readFileSync(r.files[0]!, 'utf8')).toBe('phát hành');
    expect(existsSync(s.store.abs(`videos/${s.video}/renders/rd_bbbbbbbb/video.mp4`))).toBe(true);
  });

  it('falls back to the newest draft, marked (nháp)', () => {
    const s = setup();
    s.render('rd_aaaaaaaa', 'draft', '2026-10-08T03:00:00.000Z', 'nháp');
    const r = exportVideo({ channel: s.dir, video: s.video, dest_dir: s.out });
    expect(path.basename(r.files[0]!)).toBe('Lốc xoáy vì sao (nháp).mp4');
  });

  it('adds the chosen extras; missing sources are reported as skipped', () => {
    const s = setup();
    s.render('rd_bbbbbbbb', 'release', '2026-10-08T02:00:00.000Z', 'mp4');
    s.w(
      'publish.md',
      '---\nschema_version: 1\ntitle: "Tiêu đề đăng"\ntags: ["a","b"]\nchapters: [{"start_ms":0,"title":"Mở đầu"},{"start_ms":65000,"title":"Kết"}]\n---\nMô tả video.\n',
    );
    s.w('thumbnail.jpg', Buffer.from('jpg'));
    const r = exportVideo({
      channel: s.dir,
      video: s.video,
      dest_dir: s.out,
      include: { thumbnail: true, captions: true, description: true },
    });
    expect(readdirSync(s.out).sort()).toEqual([
      'Tiêu đề đăng.jpg',
      'Tiêu đề đăng.mp4',
      'Tiêu đề đăng.txt',
    ]);
    expect(r.skipped).toEqual(['captions']);
    const txt = readFileSync(path.join(s.out, 'Tiêu đề đăng.txt'), 'utf8');
    expect(txt).toContain('Tiêu đề đăng');
    expect(txt).toContain('Mô tả video.');
    expect(txt).toContain('0:00 Mở đầu');
    expect(txt).toContain('1:05 Kết');
    expect(txt).toContain('#a #b');
  });

  it('writes subtitles from caption groups', () => {
    const s = setup();
    s.render('rd_bbbbbbbb', 'release', '2026-10-08T02:00:00.000Z', 'mp4');
    s.w(
      'caption_groups.json',
      JSON.stringify({
        schema_version: 1,
        groups: [{ id: 'cg_1', start_ms: 0, end_ms: 1500, text: 'Xin chào' }],
      }),
    );
    const r = exportVideo({
      channel: s.dir,
      video: s.video,
      dest_dir: s.out,
      include: { captions: true },
    });
    const srt = r.files.find((f) => f.endsWith('.srt'))!;
    expect(readFileSync(srt, 'utf8')).toContain('00:00:00,000 --> 00:00:01,500\nXin chào');
  });

  it('never overwrites: a name clash moves the whole set to (2)', () => {
    const s = setup();
    s.render('rd_bbbbbbbb', 'release', '2026-10-08T02:00:00.000Z', 'mp4');
    s.w('thumbnail.jpg', Buffer.from('jpg'));
    const first = exportVideo({ channel: s.dir, video: s.video, dest_dir: s.out, name: 'Bản' });
    const again = exportVideo({
      channel: s.dir,
      video: s.video,
      dest_dir: s.out,
      name: 'Bản',
      include: { thumbnail: true },
    });
    expect(first.files.map((f) => path.basename(f))).toEqual(['Bản.mp4']);
    expect(again.files.map((f) => path.basename(f))).toEqual(['Bản (2).mp4', 'Bản (2).jpg']);
  });

  it('refuses a folder inside the channel, a missing folder, or a video without renders', () => {
    const s = setup();
    expect(() => exportVideo({ channel: s.dir, video: s.video, dest_dir: s.out })).toThrowError(
      expect.objectContaining({ code: 'E_FILE_NOT_FOUND' }),
    );
    s.render('rd_bbbbbbbb', 'release', '2026-10-08T02:00:00.000Z', 'mp4');
    expect(() =>
      exportVideo({ channel: s.dir, video: s.video, dest_dir: path.join(s.dir, 'videos') }),
    ).toThrowError(expect.objectContaining({ code: 'E_SCHEMA_INVALID' }));
    expect(() =>
      exportVideo({ channel: s.dir, video: s.video, dest_dir: path.join(s.out, 'không có') }),
    ).toThrowError(expect.objectContaining({ code: 'E_FILE_NOT_FOUND' }));
  });

  it('cleans names for Windows', () => {
    expect(safeFileName('a<b>c:d"e/f\\g|h?i*j. ')).toBe('abcdefghij');
    expect(safeFileName('CON')).toBe('CON_');
    expect(safeFileName('   ')).toBe('video');
  });
});

describe('render library (073)', () => {
  it('lists finished renders of every video, newest first, with the video title', () => {
    const s = setup();
    s.render('rd_aaaaaaaa', 'draft', '2026-10-08T01:00:00.000Z', 'nháp');
    s.render('rd_bbbbbbbb', 'release', '2026-10-08T02:00:00.000Z', 'phát hành');
    const lib = renderLibrary(s.dir);
    expect(lib.map((x) => [x.video_id, x.render_id, x.mode, x.title])).toEqual([
      [s.video, 'rd_bbbbbbbb', 'release', 'Lốc xoáy: vì sao?'],
      [s.video, 'rd_aaaaaaaa', 'draft', 'Lốc xoáy: vì sao?'],
    ]);
    expect(lib[0]!.file).toMatch(/video\.mp4$/);
  });
});
