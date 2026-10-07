import type { SchemaRoot } from '../contracts/schemas.js';

export type ArtifactKind =
  | 'channel'
  | 'settings'
  | 'output_profile'
  | 'cast_member'
  | 'asset_manifest'
  | 'music_manifest'
  | 'state'
  | 'audio_meta'
  | 'caption_groups'
  | 'caption_overrides'
  | 'lipsync'
  | 'review_round'
  | 'provenance'
  | 'render_record'
  | 'brief'
  | 'frame_md'
  | 'story'
  | 'script'
  | 'storyboard'
  | 'cast'
  | 'publish'
  | 'research'
  | 'plan';

interface KindSpec {
  kind: ArtifactKind;
  pattern: RegExp;
  format: 'json' | 'md';
  schema: SchemaRoot;
}

const V = '(?:^|/)videos/[^/]+/';

/** Đường dẫn (D3 mục 1) → loại artifact có schema. */
export const ARTIFACTS: KindSpec[] = [
  { kind: 'channel', pattern: /(?:^|\/)channel\.json$/, format: 'json', schema: 'ChannelConfig' },
  {
    kind: 'settings',
    pattern: /(?:^|\/)settings\.json$/,
    format: 'json',
    schema: 'SettingsConfig',
  },
  {
    kind: 'output_profile',
    pattern: /(?:^|\/)outputs\/[^/]+\/output\.json$/,
    format: 'json',
    schema: 'OutputProfile',
  },
  {
    kind: 'cast_member',
    pattern: /(?:^|\/)characters\/[^/]+\/cast\.json$/,
    format: 'json',
    schema: 'CastMember',
  },
  {
    kind: 'music_manifest',
    pattern: /(?:^|\/)music\/manifest\.json$/,
    format: 'json',
    schema: 'MusicManifest',
  },
  {
    kind: 'asset_manifest',
    pattern: /(?:^|\/)assets\/manifest\.json$/,
    format: 'json',
    schema: 'AssetManifest',
  },
  { kind: 'state', pattern: new RegExp(`${V}state\\.json$`), format: 'json', schema: 'VideoState' },
  {
    kind: 'audio_meta',
    pattern: new RegExp(`${V}audio_meta\\.json$`),
    format: 'json',
    schema: 'AudioMeta',
  },
  {
    kind: 'caption_groups',
    pattern: new RegExp(`${V}caption_groups\\.json$`),
    format: 'json',
    schema: 'CaptionGroups',
  },
  {
    kind: 'caption_overrides',
    pattern: new RegExp(`${V}caption-overrides\\.json$`),
    format: 'json',
    schema: 'CaptionOverrides',
  },
  {
    kind: 'lipsync',
    pattern: new RegExp(`${V}lipsync/[^/]+\\.json$`),
    format: 'json',
    schema: 'LipsyncCues',
  },
  {
    kind: 'review_round',
    pattern: new RegExp(`${V}reviews/[^/]+/round-\\d+\\.json$`),
    format: 'json',
    schema: 'ReviewRound',
  },
  {
    kind: 'provenance',
    pattern: new RegExp(`${V}provenance/[^/]+\\.json$`),
    format: 'json',
    schema: 'Provenance',
  },
  {
    kind: 'render_record',
    pattern: new RegExp(`${V}renders/[^/]+/render\\.json$`),
    format: 'json',
    schema: 'RenderRecord',
  },
  {
    kind: 'brief',
    pattern: new RegExp(`${V}BRIEF\\.md$`),
    format: 'md',
    schema: 'BriefFrontMatter',
  },
  {
    kind: 'frame_md',
    pattern: new RegExp(`${V}frame\\.md$`),
    format: 'md',
    schema: 'FrameMdFrontMatter',
  },
  { kind: 'story', pattern: new RegExp(`${V}STORY\\.md$`), format: 'md', schema: 'StoryDoc' },
  { kind: 'script', pattern: new RegExp(`${V}SCRIPT\\.md$`), format: 'md', schema: 'ScriptDoc' },
  {
    kind: 'storyboard',
    pattern: new RegExp(`${V}STORYBOARD\\.md$`),
    format: 'md',
    schema: 'StoryboardDoc',
  },
  { kind: 'cast', pattern: new RegExp(`${V}CAST\\.md$`), format: 'md', schema: 'CastDoc' },
  {
    kind: 'publish',
    pattern: new RegExp(`${V}publish\\.md$`),
    format: 'md',
    schema: 'PublishFrontMatter',
  },
  // 049: quét nghiên cứu Autopilot theo ngày ở gốc kênh (D3 5.17)
  {
    kind: 'research',
    pattern: /^research\/\d{4}-\d{2}-\d{2}\.json$/,
    format: 'json',
    schema: 'ResearchDoc',
  },
  // 051: kế hoạch ngày Autopilot ở gốc kênh (D3 5.18)
  {
    kind: 'plan',
    pattern: /^autopilot\/plans\/\d{4}-\d{2}-\d{2}\.json$/,
    format: 'json',
    schema: 'DailyPlan',
  },
];

export const toPosix = (p: string): string => p.replaceAll('\\', '/');

export function artifactSpec(p: string): KindSpec | undefined {
  const posix = toPosix(p);
  return ARTIFACTS.find((a) => a.pattern.test(posix));
}

export function artifactKind(p: string): ArtifactKind | undefined {
  return artifactSpec(p)?.kind;
}
