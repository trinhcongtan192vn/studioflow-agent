// 008 · FR-CH-02/03 — hiển thị tài liệu md đẹp + CTA sau mỗi bước trong chat.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDoc, showValue } from '../../src/renderer/doc-format';
import {
  activityLabel,
  changedSteps,
  fileCtaLabel,
  friendlyStepError,
  stepCtas,
  voiceSuggestion,
} from '../../src/renderer/chat-format';

const vd = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/core/tests/fixtures/domain/channel/videos/vd_8m2pq7rt',
);
const read = (f: string) => readFileSync(path.join(vd, f), 'utf8');

describe('parseDoc', () => {
  it('SCRIPT.md: front matter, beat headings, lines with speaker/emotion/direction, tts hidden', () => {
    const d = parseDoc(read('SCRIPT.md'));
    expect(Object.fromEntries(d.front)).toMatchObject({
      video_id: 'vd_8m2pq7rt',
      status: 'approved',
    });
    expect(d.blocks[0]).toEqual({ kind: 'prose', text: expect.stringContaining('Ghi chú tự do') });
    expect(d.blocks[1]).toEqual({ kind: 'heading', level: 2, text: 'Mở đầu', beat: true });
    expect(d.blocks[2]).toEqual({
      kind: 'line',
      speaker: 'narrator',
      emotion: 'calm',
      pause: 300,
      text: 'Năm 1428, Lê Lợi lên ngôi.',
      tts: 'Năm một nghìn bốn trăm hai mươi tám, Lê Lợi lên ngôi.',
    });
    expect(d.blocks[3]).toMatchObject({
      kind: 'line',
      speaker: 'ca_a7f2k9wd',
      direction: 'giọng run',
      text: 'Bệ hạ…',
    });
    const last = d.blocks.at(-1)!;
    expect(last).toMatchObject({
      kind: 'line',
      text: 'Triều Hậu Lê bắt đầu\nkéo dài hơn ba trăm năm.',
    });
    expect(JSON.stringify(d)).not.toContain('<!--');
  });

  it('STORYBOARD.md: sf-scene / sf-frame blocks parsed as data', () => {
    const d = parseDoc(read('STORYBOARD.md'));
    const data = d.blocks.filter((b) => b.kind === 'data');
    expect(data.map((b) => b.kind === 'data' && b.tag)).toEqual([
      'sf-scene',
      'sf-frame',
      'sf-frame',
    ]);
    const fr = data[1] as { data: { layers: unknown[]; intent: string } };
    expect(fr.data.layers).toHaveLength(2);
    expect(fr.data.intent).toContain('Bản đồ');
  });

  it('BRIEF.md front matter with inline maps and comments; CAST sf-cast list', () => {
    const b = Object.fromEntries(parseDoc(read('BRIEF.md')).front);
    expect(b.proposed_workflow).toEqual({ id: 'narrated-explainer', version: '1.0.0' });
    expect(showValue('target_duration_ms', b.target_duration_ms)).toBe('10 phút');
    const c = parseDoc(read('CAST.md')).blocks.find((x) => x.kind === 'data');
    expect(c).toMatchObject({ tag: 'sf-cast', data: [{ id: 'ca_a7f2k9wd' }] });
  });

  it('broken YAML degrades to raw text', () => {
    const d = parseDoc('---\na: [\n---\n```sf-frame\nx: [\n```\n');
    expect(d.front[0]![0]).toBe('front matter');
    expect(d.blocks[0]).toMatchObject({ kind: 'data', data: 'x: [' });
  });
});

describe('step CTAs', () => {
  it('maps outputs to buttons, preview tab for visual steps, retry on failure', () => {
    expect(fileCtaLabel('SCRIPT.md')).toBe('Xem kịch bản');
    expect(fileCtaLabel('renders/rn_1/video.mp4')).toBe('Xem video');
    expect(fileCtaLabel('caption_groups.json')).toBeUndefined();
    expect(stepCtas({ id: 'design', status: 'done' }, ['BRIEF.md', 'frame.md'])).toEqual([
      { kind: 'file', label: 'Xem brief', path: 'BRIEF.md' },
      { kind: 'file', label: 'Xem design system', path: 'frame.md' },
    ]);
    expect(stepCtas({ id: 'frames', status: 'done' })).toEqual([
      { kind: 'tab', label: 'Mở xem trước', tab: 'Xem trước' },
    ]);
    expect(stepCtas({ id: 'voice', status: 'failed' }, ['SCRIPT.md'])).toEqual([
      { kind: 'retry', label: 'Chạy lại bước', step: 'voice' },
    ]);
  });

  it('changedSteps reports only transitions to done/failed after the first snapshot', () => {
    const steps = [
      { id: 'design', status: 'done' },
      { id: 'script', status: 'failed' },
      { id: 'voice', status: 'running' },
    ];
    expect(changedSteps({}, steps)).toEqual([]);
    expect(
      changedSteps({ design: 'running', script: 'running', voice: 'pending' }, steps).map(
        (s) => s.id,
      ),
    ).toEqual(['design', 'script']);
    expect(changedSteps({ design: 'done', script: 'failed', voice: 'running' }, steps)).toEqual([]);
  });
});

describe('activityLabel', () => {
  it('describes what the agent is doing', () => {
    expect(activityLabel({ kind: 'thinking' })).toBe('Đang suy nghĩ');
    expect(activityLabel({ kind: 'writing' })).toBe('Đang viết câu trả lời');
    expect(
      activityLabel({
        kind: 'tool',
        name: 'mcp__studioflow__artifact_read',
        input: { path: 'SCRIPT.md' },
      }),
    ).toBe('Đọc tệp: SCRIPT.md');
    expect(activityLabel({ kind: 'tool', name: 'image_generate', input: {} })).toBe('Sinh ảnh');
  });
});

describe('missing voice', () => {
  const err =
    'no voice for narrator: set voice.id for the channel/video — create a voice with voice.profile_create from a 3–10 s sample the user attaches, then rerun this step';
  it('offers picking a voice sample, then retry', () => {
    const c = stepCtas({ id: 'voice', status: 'failed', title: 'Giọng đọc' }, [], err);
    expect(c.map((x) => x.kind)).toEqual(['say', 'voice', 'retry']);
    expect(c[1]).toMatchObject({ prompt: expect.stringContaining('Giọng đọc') });
  });
  it('explains in plain words and collapses per-line errors', () => {
    expect(friendlyStepError(err)).toMatch(/^Chưa có giọng đọc cho người dẫn\./);
    const many = Array.from({ length: 5 }, (_, i) => `audio.line:ln_${i}: boom`).join('; ');
    expect(friendlyStepError(many)).toBe('boom (và 4 lỗi tương tự)');
  });
});

describe('voice suggestions (033)', () => {
  const job = {
    id: 'jb_1',
    kind: 'voice.design',
    status: 'succeeded',
    result: {
      voice_id: 'vo_ab12cd34',
      name: 'Giọng nữ trẻ',
      for: 'narrator',
      preview: 'voices/vo_ab12cd34/ref.wav',
      design: { instruct: 'female, young adult, moderate pitch', seed: 0 },
    },
  };
  it('turns a finished voice.design job into a suggestion card', () => {
    expect(voiceSuggestion(job)).toEqual({
      voice_id: 'vo_ab12cd34',
      name: 'Giọng nữ trẻ',
      for: 'narrator',
      forLabel: 'người dẫn',
      preview: 'voices/vo_ab12cd34/ref.wav',
      traits: ['Nữ', 'Thanh niên', 'Cao độ vừa'],
      pick: 'Chọn giọng "Giọng nữ trẻ" (vo_ab12cd34) cho người dẫn.',
    });
    expect(voiceSuggestion({ ...job, status: 'running' })).toBeUndefined();
    expect(voiceSuggestion({ ...job, kind: 'voice.profile' })).toBeUndefined();
  });
  it('missing voice offers suggested voices first', () => {
    const c = stepCtas(
      { id: 'voice', status: 'failed', title: 'Giọng đọc' },
      [],
      'no voice for narrator: set voice.id',
    );
    expect(c.map((x) => x.kind)).toEqual(['say', 'voice', 'retry']);
    expect(c[0]).toMatchObject({ label: '✨ Gợi ý giọng' });
  });
});
