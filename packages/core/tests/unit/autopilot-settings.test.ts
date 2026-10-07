// 047 — cài đặt Autopilot theo kênh (D3 7.2 `autopilot.*`, `publish.*`): kiểm giá trị, đọc/ghi tầng kênh,
// Autopilot bật → "Tự duyệt bước" bật; đối thủ nhập bằng URL / @handle / ID → ID kênh YouTube.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_AUTOPILOT_KEYS,
  CHANNEL_AUTOPILOT_KEYS,
  channelAutopilot,
  checkAutopilotValue,
  parseChannelInput,
  resolveYouTubeChannel,
  setChannelAutopilot,
} from '../../src/autopilot/index.js';
import { autopilotOf } from '../../src/domain/autopilot.js';
import { workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture | undefined;
afterEach(() => {
  fx?.cleanup();
  fx = undefined;
});

describe('checkAutopilotValue', () => {
  const ok = (k: string, v: unknown) => expect(() => checkAutopilotValue(k, v)).not.toThrow();
  const bad = (k: string, v: unknown) =>
    expect(() => checkAutopilotValue(k, v)).toThrowError(
      expect.objectContaining({ code: 'E_SCHEMA_INVALID' }),
    );
  it('accepts well-formed values', () => {
    ok('autopilot.competitors', ['UCuAXFkgsw1L7xaCfnd5JJOw']);
    ok('publish.slots', ['19:00', 'sat 09:30', 'mon-fri 07:15']);
    ok('autopilot.work_window', '08:00-23:00');
    ok('autopilot.work_window', '22:00-06:00'); // qua đêm
    ok('autopilot.budget_share', 0.7);
    ok('autopilot.max_per_day', 3);
    ok('publish.platforms', ['youtube', 'tiktok']);
    ok('publish.timezone', 'Asia/Ho_Chi_Minh');
    ok('publish.veto_hours', 0);
  });
  it('rejects malformed values', () => {
    bad('autopilot.competitors', ['@kenhkhac']); // phải là ID đã giải
    bad('publish.slots', ['7pm']);
    bad('publish.slots', ['funday 10:00']);
    bad('autopilot.work_window', '8-23');
    bad('autopilot.budget_share', 1.5);
    bad('autopilot.max_per_day', 2.5);
    bad('autopilot.max_per_day', 50);
    bad('publish.platforms', ['instagram']);
    bad('publish.timezone', 'Mars/Base');
    bad('publish.veto_hours', -1);
    bad('autopilot.enabled', 'yes'); // sai kiểu (bảng D3)
  });
  it('splits keys by tier as in D3 7.2', () => {
    expect(CHANNEL_AUTOPILOT_KEYS).toContain('autopilot.competitors');
    expect(CHANNEL_AUTOPILOT_KEYS).not.toContain('autopilot.work_window');
    expect(APP_AUTOPILOT_KEYS).toEqual(
      expect.arrayContaining([
        'autopilot.work_window',
        'autopilot.budget_share',
        'autopilot.paused',
      ]),
    );
  });
});

describe('channel autopilot settings', () => {
  it('reads defaults, writes the channel tier through the write module', () => {
    fx = workflowFixture();
    const v = channelAutopilot(fx.dir);
    expect(v['autopilot.enabled']).toEqual({ value: false, source: 'default' });
    expect(v['publish.slots']!.value).toEqual(['19:00']);
    setChannelAutopilot(fx.store, 'autopilot.pillars', ['lịch sử', 'khoa học']);
    setChannelAutopilot(fx.store, 'autopilot.enabled', true);
    const ch = JSON.parse(readFileSync(fx.store.abs('channel.json'), 'utf8'));
    expect(ch.config['autopilot.pillars']).toEqual(['lịch sử', 'khoa học']);
    expect(channelAutopilot(fx.dir)['autopilot.enabled']).toEqual({
      value: true,
      source: 'channel',
    });
    expect(() =>
      setChannelAutopilot(fx!.store, 'autopilot.work_window', '08:00-20:00'),
    ).toThrowError(expect.objectContaining({ code: 'E_CONFIG_SCOPE' }));
  });

  it('Autopilot on for the channel turns "Tự duyệt bước" on for its videos', () => {
    fx = workflowFixture();
    const st = JSON.parse(readFileSync(fx.store.abs(fx.v('state.json')), 'utf8'));
    st.config_overrides = { 'workflow.autopilot': false };
    fx.store.write(fx.v('state.json'), `${JSON.stringify(st, null, 2)}\n`, { by: 'test' });
    expect(autopilotOf(fx.dir, fx.videoId).on).toBe(false);
    setChannelAutopilot(fx.store, 'autopilot.enabled', true);
    expect(autopilotOf(fx.dir, fx.videoId).on).toBe(true);
  });
});

describe('competitor input → YouTube channel id', () => {
  it('parses ids, handles and channel URLs', () => {
    expect(parseChannelInput('UCuAXFkgsw1L7xaCfnd5JJOw')).toEqual({
      id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    });
    expect(parseChannelInput('@RickAstleyYT')).toEqual({ handle: '@RickAstleyYT' });
    expect(parseChannelInput('https://www.youtube.com/@RickAstleyYT/videos')).toEqual({
      handle: '@RickAstleyYT',
    });
    expect(parseChannelInput('https://youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw')).toEqual({
      id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    });
    expect(parseChannelInput('https://www.youtube.com/user/RickAstleyVEVO')).toEqual({
      username: 'RickAstleyVEVO',
    });
    expect(parseChannelInput('https://www.youtube.com/c/SomeName')).toEqual({ query: 'SomeName' });
    expect(parseChannelInput('https://vimeo.com/x')).toBeUndefined();
  });

  it('resolves through the YouTube Data API (1 unit) and returns a compact card', async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
              snippet: {
                title: 'Rick Astley',
                customUrl: '@rickastleyyt',
                thumbnails: { default: { url: 'https://yt3.example/a.jpg' } },
              },
              statistics: { subscriberCount: '4200000', videoCount: '300' },
            },
          ],
        }),
        { status: 200 },
      );
    };
    const c = await resolveYouTubeChannel('@RickAstleyYT', { apiKey: 'k', fetch: fetchFn });
    expect(c).toEqual({
      id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
      title: 'Rick Astley',
      handle: '@rickastleyyt',
      thumbnail: 'https://yt3.example/a.jpg',
      subscribers: 4200000,
      videos: 300,
    });
    expect(calls[0]).toContain('/youtube/v3/channels?');
    expect(calls[0]).toContain('forHandle=%40RickAstleyYT');
    expect(calls[0]).toContain('key=k');
    await expect(
      resolveYouTubeChannel('@khongco', {
        apiKey: 'k',
        fetch: async () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
      }),
    ).rejects.toMatchObject({ code: 'E_FILE_NOT_FOUND' });
    await expect(resolveYouTubeChannel('@x', { apiKey: undefined })).rejects.toMatchObject({
      code: 'E_PROVIDER_UNAVAILABLE',
    });
  });
});
