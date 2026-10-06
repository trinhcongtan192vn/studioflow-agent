// MCP server giả (stdio) cùng tên tool/định dạng với zubeid-youtube-mcp-server 1.0.2 — test 044, không gọi mạng.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

if (!process.env.YOUTUBE_API_KEY) {
  console.error('Error: at least one YouTube API key is required.');
  process.exit(1);
}
const server = new McpServer({ name: 'fake-youtube', version: '1.0.0' });
const json = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 2) }] });
const err = (m) => ({ content: [{ type: 'text', text: `Error: ${m}` }], isError: true });

server.tool(
  'videos_getVideo',
  { videoId: z.string(), parts: z.array(z.string()).optional() },
  async ({ videoId }) =>
    videoId === 'missing0000'
      ? json(null)
      : json({
          id: videoId,
          snippet: {
            title: 'Vì sao bầu trời màu xanh?',
            description: 'Mô tả dài '.repeat(800),
            channelTitle: 'Kênh Khoa Học',
            channelId: 'UC1234567890',
            publishedAt: '2026-01-02T03:04:05Z',
            tags: ['khoa học', 'bầu trời'],
          },
          contentDetails: { duration: 'PT8M31S' },
          statistics: { viewCount: '120000', likeCount: '5400', commentCount: '310' },
        }),
);
server.tool(
  'transcripts_getTranscript',
  { videoId: z.string(), language: z.string().optional() },
  async ({ language }) =>
    language === 'vi'
      ? json({
          videoId: 'x',
          language,
          transcript: [
            { text: 'Bạn có bao giờ tự hỏi', offset: 0, duration: 2000 },
            { text: 'vì sao trời xanh?', offset: 2000, duration: 1500 },
            { text: 'Câu trả lời nằm ở ánh sáng.', offset: 65000, duration: 3000 },
          ],
        })
      : err(`Failed to get transcript: no transcript in ${language}`),
);
server.tool(
  'videos_searchVideos',
  {
    query: z.string(),
    maxResults: z.number().optional(),
    order: z.string().optional(),
    publishedAfter: z.string().optional(),
  },
  async ({ query }) =>
    json([
      {
        id: { videoId: 'abcdefghijk' },
        snippet: {
          title: `Kết quả cho ${query}`,
          channelTitle: 'Đối thủ A',
          channelId: 'UCa',
          publishedAt: '2026-09-01T00:00:00Z',
          description: 'Ngắn',
        },
      },
    ]),
);
server.tool(
  'channels_listVideos',
  { channelId: z.string(), maxResults: z.number().optional() },
  async () =>
    json([
      {
        id: { videoId: 'zzzzzzzzzzz' },
        snippet: {
          title: 'Video mới nhất',
          channelTitle: 'Đối thủ A',
          channelId: 'UCa',
          publishedAt: '2026-09-30T00:00:00Z',
        },
      },
    ]),
);
await server.connect(new StdioServerTransport());
