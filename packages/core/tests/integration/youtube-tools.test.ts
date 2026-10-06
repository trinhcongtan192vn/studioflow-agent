// 044 — tool youtube.* của Gateway bọc MCP server YouTube (stdio): ID từ URL, dữ liệu gọn cho agent,
// transcript thử nhiều ngôn ngữ, thiếu khóa API → lỗi rõ ràng. MCP server giả, không gọi mạng.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseYouTubeId, YouTubeMcp, youtubeTools } from '../../src/youtube/index.js';
import { workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

const fake = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/fake-youtube-mcp.mjs',
);

describe('parseYouTubeId', () => {
  it('accepts every common URL form and bare ids', () => {
    for (const u of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
      'dQw4w9WgXcQ',
    ])
      expect(parseYouTubeId(u)).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeUndefined();
    expect(parseYouTubeId('không phải url')).toBeUndefined();
  });
});

let fx: WorkflowFixture | undefined;
let mcp: YouTubeMcp | undefined;
afterEach(async () => {
  await mcp?.close();
  fx?.cleanup();
  mcp = undefined;
  fx = undefined;
});

const tools = (apiKey: string | undefined) => {
  mcp = new YouTubeMcp({
    server: async () => ({ command: process.execPath, args: [fake] }),
    apiKey: () => apiKey,
  });
  return Object.fromEntries(youtubeTools(mcp).map((t) => [t.name, t]));
};
const ctx = () => {
  fx = workflowFixture();
  return { store: fx.store } as never;
};

describe('youtube.* tools over MCP (044)', () => {
  it('video: condensed metadata from a URL; transcript falls back across languages with timestamps', async () => {
    const t = tools('test-key');
    const v = (await t['youtube.video']!.handler(
      { url: 'https://youtu.be/dQw4w9WgXcQ' },
      ctx(),
    )) as Record<string, unknown>;
    expect(v).toMatchObject({
      video_id: 'dQw4w9WgXcQ',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Vì sao bầu trời màu xanh?',
      channel: { id: 'UC1234567890', title: 'Kênh Khoa Học' },
      duration_s: 511,
      stats: { views: 120000, likes: 5400, comments: 310 },
      tags: ['khoa học', 'bầu trời'],
    });
    expect(String(v.description).length).toBeLessThanOrEqual(2001);
    const tr = (await t['youtube.transcript']!.handler(
      { url: 'dQw4w9WgXcQ', language: 'en' },
      ctx(),
    )) as { language: string; text: string; segments: number };
    expect(tr.language).toBe('vi'); // en không có → thử vi
    expect(tr.segments).toBe(3);
    expect(tr.text.split('\n')[0]).toBe('[0:00] Bạn có bao giờ tự hỏi vì sao trời xanh?');
    expect(tr.text).toContain('[1:05] Câu trả lời nằm ở ánh sáng.');
  });

  it('search and channel_videos return compact lists for research', async () => {
    const t = tools('test-key');
    const s = (await t['youtube.search']!.handler(
      { query: 'nhật thực', max_results: 5 },
      ctx(),
    )) as {
      videos: unknown[];
    };
    expect(s.videos).toEqual([
      {
        video_id: 'abcdefghijk',
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        title: 'Kết quả cho nhật thực',
        channel: { id: 'UCa', title: 'Đối thủ A' },
        published_at: '2026-09-01T00:00:00Z',
      },
    ]);
    const c = (await t['youtube.channel_videos']!.handler({ channel_id: 'UCa' }, ctx())) as {
      videos: { title: string }[];
    };
    expect(c.videos[0]!.title).toBe('Video mới nhất');
  });

  it('a bad URL, an unknown video and a missing API key give clear errors', async () => {
    const t = tools('test-key');
    await expect(
      t['youtube.video']!.handler({ url: 'https://vimeo.com/1' }, ctx()),
    ).rejects.toMatchObject({
      code: 'E_SCHEMA_INVALID',
    });
    await expect(t['youtube.video']!.handler({ url: 'missing0000' }, ctx())).rejects.toMatchObject({
      code: 'E_FILE_NOT_FOUND',
    });
    await mcp!.close();
    const none = tools(undefined);
    await expect(
      none['youtube.video']!.handler({ url: 'dQw4w9WgXcQ' }, ctx()),
    ).rejects.toMatchObject({
      code: 'E_PROVIDER_UNAVAILABLE',
      message: expect.stringContaining('Cài đặt'),
    });
  });
});
