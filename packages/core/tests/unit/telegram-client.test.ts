// 055 · FR-AP-11/12 — client Bot API Telegram: escape, chia tin dài, thử lại, không lộ token.
import { describe, expect, it } from 'vitest';
import { maskSecrets } from '../../src/log.js';
import {
  escapeHtml,
  escapeMarkdownV2,
  splitMessage,
  TelegramApiError,
  TelegramClient,
  type FetchLike,
} from '../../src/telegram/client.js';

const TOKEN = '123456789:AAEhBP0av28gXAAxxxxxxxxxxxxxxxxxxxx';
const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const fail = (code: number, description: string, extra: object = {}) =>
  new Response(JSON.stringify({ ok: false, error_code: code, description, ...extra }), {
    status: code,
  });

function rig(
  handler: (n: number, url: string, body: unknown) => Response | Promise<Response> | Error,
) {
  const calls: { url: string; body: unknown; init: Parameters<FetchLike>[1] }[] = [];
  const sleeps: number[] = [];
  const f: FetchLike = async (url, init) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ url, body, init });
    const r = handler(calls.length, url, body);
    if (r instanceof Error) throw r;
    return r;
  };
  const client = new TelegramClient({
    token: TOKEN,
    fetch: f,
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { client, calls, sleeps };
}

describe('escape', () => {
  it('HTML: & < > only', () => {
    expect(escapeHtml('a < b && c > d "q" <b>x</b>')).toBe(
      'a &lt; b &amp;&amp; c &gt; d "q" &lt;b&gt;x&lt;/b&gt;',
    );
  });
  it('MarkdownV2: every reserved character is backslash-escaped', () => {
    const reserved = '_*[]()~`>#+-=|{}.!\\';
    expect(escapeMarkdownV2(reserved)).toBe([...reserved].map((c) => `\\${c}`).join(''));
    expect(escapeMarkdownV2('Giá 1.5 (tốt) - 100%!')).toBe('Giá 1\\.5 \\(tốt\\) \\- 100%\\!');
    expect(escapeMarkdownV2('plain tiếng Việt')).toBe('plain tiếng Việt');
  });
});

describe('splitMessage', () => {
  it('short text is untouched', () => {
    expect(splitMessage('xin chào')).toEqual(['xin chào']);
  });
  it('splits at newlines, never above 4096, and loses no content', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `Dòng số ${i} ${'x'.repeat(40)}`);
    const text = lines.join('\n');
    const parts = splitMessage(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join('\n')).toBe(text);
  });
  it('a single huge line is cut hard; spaces are preferred', () => {
    const word = 'abcdefghi ';
    const text = word.repeat(1000);
    const parts = splitMessage(text, 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.trim());
    const blob = 'z'.repeat(250);
    expect(splitMessage(blob, 100).map((p) => p.length)).toEqual([100, 100, 50]);
  });
});

describe('TelegramClient', () => {
  it('getMe / getUpdates post JSON to the bot URL with offset and allowed_updates', async () => {
    const { client, calls } = rig((n) =>
      n === 1 ? ok({ id: 7, is_bot: true, username: 'sf_bot' }) : ok([{ update_id: 5 }]),
    );
    expect(await client.getMe()).toMatchObject({ username: 'sf_bot' });
    expect(await client.getUpdates({ offset: 5, timeout: 20 })).toEqual([{ update_id: 5 }]);
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
    expect(calls[1]!.body).toMatchObject({
      offset: 5,
      timeout: 20,
      allowed_updates: ['message', 'callback_query'],
    });
  });

  it('sendMessage splits long text; the keyboard is only on the last part; reply goes to the first', async () => {
    const { client, calls } = rig(() => ok({ message_id: 1, chat: { id: 1, type: 'group' } }));
    const text = Array.from({ length: 200 }, (_, i) => `d${i} ${'y'.repeat(60)}`).join('\n');
    const kb = { inline_keyboard: [[{ text: 'OK', callback_data: 'x:1' }]] };
    const sent = await client.sendMessage(-100123, text, {
      parse_mode: 'HTML',
      reply_markup: kb,
      reply_to_message_id: 9,
    });
    expect(sent.length).toBe(calls.length);
    expect(calls.length).toBeGreaterThan(1);
    const bodies = calls.map((c) => c.body as Record<string, unknown>);
    expect(
      bodies.every(
        (b) =>
          (b.text as string).length <= 4096 && b.parse_mode === 'HTML' && b.chat_id === -100123,
      ),
    ).toBe(true);
    expect(bodies.at(-1)!.reply_markup).toEqual(kb);
    expect(bodies.slice(0, -1).every((b) => !('reply_markup' in b))).toBe(true);
    expect(bodies[0]!.reply_parameters).toEqual({
      message_id: 9,
      allow_sending_without_reply: true,
    });
    expect(bodies.slice(1).every((b) => !('reply_parameters' in b))).toBe(true);
  });

  it('retries 429 after retry_after and network errors with backoff, then succeeds', async () => {
    const { client, calls, sleeps } = rig((n) =>
      n === 1
        ? fail(429, 'Too Many Requests', { parameters: { retry_after: 3 } })
        : n === 2
          ? new Error('ECONNRESET')
          : ok({ message_id: 2, chat: { id: 1, type: 'private' } }),
    );
    await client.sendMessage(1, 'hi');
    expect(calls.length).toBe(3);
    expect(sleeps).toEqual([3000, 1000]);
  });

  it('gives up after the retry budget with a network error that never mentions the token', async () => {
    const { client, calls } = rig(
      () => new Error(`connect failed https://api.telegram.org/bot${TOKEN}/sendMessage`),
    );
    const err = await client.sendMessage(1, 'hi').catch((e: unknown) => e as TelegramApiError);
    expect(err).toBeInstanceOf(TelegramApiError);
    expect((err as TelegramApiError).kind).toBe('network');
    expect(calls.length).toBe(4); // 1 + 3 lần thử lại
    expect((err as Error).message).not.toContain(TOKEN);
    expect(String((err as Error).message)).not.toMatch(/bot\d/);
  });

  it('API errors keep status and description; 401/409 are not retried', async () => {
    const { client, calls } = rig(() => fail(401, 'Unauthorized'));
    const e = (await client.sendMessage(1, 'x').catch((x: unknown) => x)) as TelegramApiError;
    expect(e).toMatchObject({ kind: 'api', status: 401 });
    expect(calls.length).toBe(1);
    const r = rig(() => fail(409, 'Conflict: terminated by other getUpdates request'));
    const e2 = (await r.client.getUpdates().catch((x: unknown) => x)) as TelegramApiError;
    expect(e2.status).toBe(409);
    expect(r.calls.length).toBe(1);
  });

  it('getUpdates never retries (the poll loop owns backoff)', async () => {
    const { client, calls } = rig(() => new Error('down'));
    await client.getUpdates().catch(() => {});
    expect(calls.length).toBe(1);
  });

  it('non-JSON HTTP failures are reported as http errors', async () => {
    const { client } = rig(() => new Response('<html>bad gateway</html>', { status: 502 }));
    const e = (await client.getMe().catch((x: unknown) => x)) as TelegramApiError;
    expect(e).toMatchObject({ kind: 'http', status: 502 });
  });

  it('sendPhoto: URL as JSON, bytes as multipart; caption cut to 1024; markup serialized', async () => {
    const { client, calls } = rig(() => ok({ message_id: 3, chat: { id: 1, type: 'group' } }));
    await client.sendPhoto(1, 'https://example.com/a.jpg', { caption: 'c'.repeat(2000) });
    expect((calls[0]!.body as { caption: string }).caption.length).toBe(1024);
    await client.sendPhoto(
      1,
      { bytes: new Uint8Array([1, 2, 3]), filename: 'a.jpg' },
      {
        caption: 'xin chào',
        reply_markup: { inline_keyboard: [[{ text: 'Hủy', callback_data: 'p:c' }]] },
      },
    );
    const form = calls[1]!.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('chat_id')).toBe('1');
    expect(form.get('caption')).toBe('xin chào');
    expect((form.get('photo') as File).name).toBe('a.jpg');
    expect(JSON.parse(form.get('reply_markup') as string).inline_keyboard[0][0].callback_data).toBe(
      'p:c',
    );
  });

  it('editMessageReplyMarkup without markup clears the keyboard; answerCallbackQuery clips the text', async () => {
    const { client, calls } = rig(() => ok(true));
    await client.editMessageReplyMarkup(5, 6);
    expect(calls[0]!.body).toMatchObject({
      chat_id: 5,
      message_id: 6,
      reply_markup: { inline_keyboard: [] },
    });
    await client.answerCallbackQuery('cb1', { text: 'a'.repeat(500), show_alert: true });
    expect((calls[1]!.body as { text: string }).text.length).toBe(200);
    expect(calls[1]!.body).toMatchObject({ callback_query_id: 'cb1', show_alert: true });
  });
});

describe('token masking in logs', () => {
  it('a bot token inside a URL is redacted', () => {
    const line = maskSecrets(`GET https://api.telegram.org/bot${TOKEN}/getUpdates failed`);
    expect(line).not.toContain('AAEhBP0av28g');
    expect(line).toContain('redacted');
  });
});
