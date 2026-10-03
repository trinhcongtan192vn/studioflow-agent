import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ChannelConfig, Lang } from '../contracts/types.js';
import { SfError } from '../errors.js';
import { APP_PROMPTS_DIR } from '../text/prompts.js';
import { WriteStore } from '../store/writer.js';
import { newId } from './ids.js';
import { validateArtifact } from './validate.js';

export type ChannelDetection = { kind: 'channel'; config: ChannelConfig } | { kind: 'not_channel' };

/** FR-WS-01: thư mục có `channel.json` hợp lệ → kênh; không có → chưa là kênh (không ghi gì). */
export function detectChannel(dir: string): ChannelDetection {
  const file = path.join(dir, 'channel.json');
  if (!existsSync(file)) return { kind: 'not_channel' };
  const text = readFileSync(file, 'utf8');
  const r = validateArtifact('channel.json', text);
  if (!r.valid) {
    throw new SfError('E_SCHEMA_INVALID', `channel.json: ${r.errors[0]!.message}`, r.errors);
  }
  return { kind: 'channel', config: JSON.parse(text) as ChannelConfig };
}

/** Thư mục con của kênh (D3 mục 1). */
export const CHANNEL_DIRS = [
  'videos',
  'voices',
  'luts',
  'mouths',
  'characters',
  'assets',
  'music',
  'cache',
  'chat',
];

function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'channel'
  );
}

/** Mẫu `profile/` tối thiểu (D6 mục 6.1); nội dung thật (gói prompt, rubric) thuộc 009/022. */
function profileTemplate(name: string): Record<string, string> {
  return {
    'profile/.claude-plugin/plugin.json': `${JSON.stringify({ name: `channel-${slug(name)}` }, null, 2)}\n`,
    'profile/skills/channel/SKILL.md': [
      '---',
      `name: channel`,
      `description: Phong cách và quy tắc nội dung của kênh ${name}.`,
      '---',
      `# Kênh ${name}`,
      '',
      'Giọng văn, phong cách, quy tắc nội dung. Tham chiếu giá trị máy đọc bằng `{{config:<khóa>}}`, ví dụ look hiện tại: `{{config:look.id}}`.',
      '',
    ].join('\n'),
    'profile/references/style-guide.md':
      '# Style guide\n\nGiọng văn, từ nên/không nên, ví dụ đoạn hay.\n',
    'profile/references/preferences.md': '# Sở thích người dùng\n\n(Ghi nhận qua chat.)\n',
    ...defaultPromptPack(),
  };
}

/** Gói prompt mặc định chép vào kênh mới để người dùng chỉnh (D6 6.2, 009 FR-004). */
function defaultPromptPack(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(APP_PROMPTS_DIR, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const rel = path
      .relative(APP_PROMPTS_DIR, path.join(e.parentPath, e.name))
      .replaceAll('\\', '/');
    out[`profile/references/prompts/${rel}`] = readFileSync(
      path.join(e.parentPath, e.name),
      'utf8',
    );
  }
  return out;
}

/** Khởi tạo kênh theo yêu cầu: `channel.json`, `profile/` mẫu, thư mục con; giữ file đang có. */
export function initChannel(dir: string, input: { name: string; language: Lang }): ChannelConfig {
  if (existsSync(path.join(dir, 'channel.json'))) {
    throw new SfError('E_CHANNEL_EXISTS', `${dir} already has channel.json`);
  }
  const store = new WriteStore(dir);
  const config: ChannelConfig = {
    schema_version: 1,
    id: newId('ch') as ChannelConfig['id'],
    name: input.name,
    language: input.language,
    created_at: new Date().toISOString(),
    profile_dir: 'profile',
    config: {},
  };
  for (const d of CHANNEL_DIRS) store.ensureDir(d);
  for (const [rel, content] of Object.entries(profileTemplate(input.name))) {
    if (!existsSync(path.join(dir, ...rel.split('/'))))
      store.write(rel, content, { by: 'channel.init' });
  }
  store.write('channel.json', `${JSON.stringify(config, null, 2)}\n`, { by: 'channel.init' });
  return config;
}
