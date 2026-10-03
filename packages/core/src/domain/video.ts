import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import type { BriefFrontMatter, ChannelConfig, VideoState } from '../contracts/types.js';
import type { WriteStore } from '../store/writer.js';
import { newId } from './ids.js';

/** ID video đã có trong kênh. */
export function listVideoIds(channelDir: string): string[] {
  const dir = path.join(channelDir, 'videos');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/**
 * FR-WS-03 / D3 mục 8: tạo `videos/<vd>/` với `state.json` (`phase: 'briefing'`) và `BRIEF.md`
 * khởi đầu. Mọi ghi đi qua module ghi.
 */
export function createVideo(store: WriteStore, input: { title?: string } = {}): VideoState {
  const channel = JSON.parse(readFileSync(store.abs('channel.json'), 'utf8')) as ChannelConfig;
  const id = newId('vd', new Set(listVideoIds(store.root))) as VideoState['video_id'];
  const now = new Date().toISOString();
  const state: VideoState = {
    schema_version: 1,
    video_id: id,
    channel_id: channel.id,
    created_at: now,
    updated_at: now,
    phase: 'briefing',
    workflow: null,
    output_profile: null,
    owner: 'agent',
    steps: {},
    approvals: [],
    pinned_frames: {},
    config_overrides: {},
    budget: { tokens_used: 0, api_cost_usd: 0 },
  };
  const brief: BriefFrontMatter = {
    schema_version: 1,
    video_id: id,
    proposed_workflow: null,
    proposed_output_profile: null,
    source_video_id: null,
    language: channel.language,
    target_duration_ms: null,
    title_working: input.title ?? '',
    approved_at: null,
  };
  const v = `videos/${id}`;
  store.write(`${v}/state.json`, `${JSON.stringify(state, null, 2)}\n`, { by: 'video.create' });
  store.write(`${v}/BRIEF.md`, `---\n${stringify(brief, { lineWidth: 0 })}---\n# Brief\n\n`, {
    by: 'video.create',
  });
  return state;
}
