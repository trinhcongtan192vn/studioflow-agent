// 055 · FR-AP-12 — vòng nhận tin của bot: lệnh, nhắc tên, trả lời bot, nhắn riêng, nút inline, người không được
// phép, offset, lùi lại khi lỗi mạng, tự tắt khi 401/409.
import { describe, expect, it } from 'vitest';
import { TelegramBot, type BotDeps } from '../../src/telegram/bot.js';
import { TelegramApiError, type TgMessage, type TgUpdate } from '../../src/telegram/client.js';

const ME = { id: 900, is_bot: true, username: 'sf_bot', first_name: 'StudioFlow' };
const GROUP = -100777;
const ALICE = { id: 11, first_name: 'Alice' };
const BOB = { id: 22, first_name: 'Bob' };

let uid = 0;
function msg(
  text: string,
  o: Partial<Omit<TgMessage, 'from'>> & {
    from?: TgMessage['from'];
    chatId?: number;
    type?: TgMessage['chat']['type'];
  } = {},
): TgUpdate {
  uid += 1;
  const { from = ALICE, chatId = GROUP, type = 'supergroup', ...rest } = o;
  return {
    update_id: uid,
    message: { message_id: 100 + uid, chat: { id: chatId, type }, from, text, ...rest },
  };
}
const mention = (text: string): Partial<TgMessage> => ({
  entities: [{ type: 'mention', offset: text.indexOf('@sf_bot'), length: 7 }],
});

function rig(
  o: Partial<BotDeps> & { allowed?: string[]; updates?: (n: number) => TgUpdate[] | Error } = {},
) {
  const sent: { chat: number | string; text: string; opts?: Record<string, unknown> }[] = [];
  const answers: { id: string; o?: Record<string, unknown> }[] = [];
  const edits: unknown[] = [];
  const sleeps: number[] = [];
  const offsets: number[] = [];
  const asked: unknown[] = [];
  const members = new Map<string, string>();
  let polls = 0;
  const bot = new TelegramBot({
    client: {
      getMe: async () => ME,
      getUpdates: async () => {
        polls += 1;
        const r = o.updates?.(polls) ?? [];
        if (r instanceof Error) throw r;
        if (!r.length) await new Promise((res) => setTimeout(res, 5));
        return r;
      },
      sendMessage: async (chat, text, opts) => {
        sent.push({ chat, text, ...(opts ? { opts: opts as Record<string, unknown> } : {}) });
        return [];
      },
      answerCallbackQuery: async (id, opts) =>
        void answers.push({ id, ...(opts ? { o: opts } : {}) }),
      editMessageReplyMarkup: async (...a) => void edits.push(a),
      getChatMember: async (chat, user) => ({ status: members.get(`${chat}:${user}`) ?? 'left' }),
    },
    chatId: () => String(GROUP),
    allowedUserIds: () => o.allowed ?? [],
    commands: {
      status: async (c) => `status for ${c.from.name} args="${c.args}"`,
      boom: async () => {
        throw new Error('hỏng rồi');
      },
      silent: async () => undefined,
      help: async () => ({ text: '<b>help</b>', parse_mode: 'HTML' }),
    },
    ask: async (q) => {
      asked.push(q);
      return `trả lời: ${q.text}`;
    },
    readOffset: o.readOffset ?? (() => undefined),
    writeOffset: (n) => void offsets.push(n),
    sleep: async (ms) => void sleeps.push(ms),
    ...o,
  } as BotDeps);
  return { bot, sent, answers, edits, sleeps, offsets, asked, members, polls: () => polls };
}

describe('commands', () => {
  it('/status in the group replies to the message; arguments are passed', async () => {
    const r = rig();
    await r.bot.handleUpdate(msg('/status hôm nay'));
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ chat: GROUP, text: 'status for Alice args="hôm nay"' });
    expect(r.sent[0]!.opts).toMatchObject({ reply_to_message_id: expect.any(Number) });
  });
  it('/status@sf_bot is for us; /status@other_bot is ignored', async () => {
    const r = rig();
    await r.bot.handleUpdate(msg('/status@sf_bot'));
    await r.bot.handleUpdate(msg('/status@SF_BOT'));
    await r.bot.handleUpdate(msg('/status@other_bot'));
    expect(r.sent).toHaveLength(2);
  });
  it('HTML replies keep their parse mode; unknown commands get a hint; /start maps to help', async () => {
    const r = rig();
    await r.bot.handleUpdate(msg('/start'));
    expect(r.sent[0]).toMatchObject({ text: '<b>help</b>', opts: { parse_mode: 'HTML' } });
    await r.bot.handleUpdate(msg('/khong_co'));
    expect(r.sent[1]!.text).toMatch(/\/help/);
  });
  it('a failing command reports the error instead of crashing; silent commands send nothing', async () => {
    const r = rig();
    await r.bot.handleUpdate(msg('/boom'));
    expect(r.sent[0]!.text).toMatch(/Lỗi khi chạy \/boom: hỏng rồi/);
    await r.bot.handleUpdate(msg('/silent'));
    expect(r.sent).toHaveLength(1);
  });
});

describe('who may talk to the bot', () => {
  it('empty allow-list: anyone in the configured group; other groups are ignored', async () => {
    const r = rig();
    await r.bot.handleUpdate(msg('/status', { from: BOB }));
    await r.bot.handleUpdate(msg('/status', { chatId: -5, from: BOB }));
    expect(r.sent).toHaveLength(1);
  });
  it('allow-list: only listed users, in the group or in private', async () => {
    const r = rig({ allowed: ['11'] });
    await r.bot.handleUpdate(msg('/status', { from: BOB }));
    expect(r.sent).toHaveLength(0);
    await r.bot.handleUpdate(msg('/status', { from: ALICE }));
    await r.bot.handleUpdate(msg('hỏi riêng', { from: ALICE, chatId: ALICE.id, type: 'private' }));
    await r.bot.handleUpdate(msg('hỏi riêng', { from: BOB, chatId: BOB.id, type: 'private' }));
    expect(r.sent).toHaveLength(2);
    // người được phép nhưng ở nhóm lạ
    await r.bot.handleUpdate(msg('/status', { from: ALICE, chatId: -9 }));
    expect(r.sent).toHaveLength(2);
  });
  it('empty allow-list + private chat: must be a member of the group (getChatMember)', async () => {
    const r = rig();
    await r.bot.handleUpdate(msg('cho hỏi', { from: BOB, chatId: BOB.id, type: 'private' }));
    expect(r.sent).toHaveLength(0);
    r.members.set(`${GROUP}:${BOB.id}`, 'member');
    await r.bot.handleUpdate(msg('cho hỏi', { from: BOB, chatId: BOB.id, type: 'private' }));
    expect(r.sent).toHaveLength(1);
  });
  it('messages from bots and channel posts are ignored', async () => {
    const r = rig();
    await r.bot.handleUpdate(msg('/status', { from: { ...ALICE, is_bot: true } as never }));
    await r.bot.handleUpdate(msg('/status', { type: 'channel' }));
    expect(r.sent).toHaveLength(0);
  });
});

describe('free-text questions go to the ops agent', () => {
  it('mention in a group: the @name is stripped', async () => {
    const r = rig();
    const text = '@sf_bot hôm nay làm được mấy video?';
    await r.bot.handleUpdate(msg(text, mention(text)));
    expect(r.asked).toEqual([
      expect.objectContaining({
        text: 'hôm nay làm được mấy video?',
        chat_id: GROUP,
        from: { id: 11, name: 'Alice' },
      }),
    ]);
    expect(r.sent[0]!.text).toBe('trả lời: hôm nay làm được mấy video?');
  });
  it('text_mention entity of the bot user counts', async () => {
    const r = rig();
    await r.bot.handleUpdate(
      msg('bot ơi video lỗi sao', {
        entities: [{ type: 'text_mention', offset: 0, length: 3, user: ME }],
      }),
    );
    expect(r.asked).toHaveLength(1);
  });
  it('reply to a bot message: ask with the quoted text as context', async () => {
    const r = rig();
    await r.bot.handleUpdate(
      msg('vì sao dừng?', {
        reply_to_message: {
          message_id: 5,
          chat: { id: GROUP, type: 'supergroup' },
          from: ME,
          text: 'Video A đã dừng',
        },
      }),
    );
    expect(r.asked).toEqual([
      expect.objectContaining({ text: 'vì sao dừng?', reply_to_text: 'Video A đã dừng' }),
    ]);
  });
  it('a reply to someone else, and plain group chatter, are ignored (privacy mode)', async () => {
    const r = rig();
    await r.bot.handleUpdate(
      msg('đồng ý', {
        reply_to_message: {
          message_id: 5,
          chat: { id: GROUP, type: 'supergroup' },
          from: BOB,
          text: 'x',
        },
      }),
    );
    await r.bot.handleUpdate(msg('chào mọi người'));
    expect(r.asked).toHaveLength(0);
    expect(r.sent).toHaveLength(0);
  });
  it('private chat with an allowed user: any text is a question', async () => {
    const r = rig({ allowed: ['11'] });
    await r.bot.handleUpdate(
      msg('tình hình sao', { from: ALICE, chatId: ALICE.id, type: 'private' }),
    );
    expect(r.asked).toHaveLength(1);
  });
  it('one question at a time per chat; ask errors are reported', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const r = rig({
      ask: async () => {
        await gate;
        return 'xong';
      },
    });
    const t = '@sf_bot câu 1';
    const first = r.bot.handleUpdate(msg(t, mention(t)));
    await new Promise((res) => setTimeout(res, 5));
    await r.bot.handleUpdate(msg('@sf_bot câu 2', mention('@sf_bot câu 2')));
    expect(r.sent[0]!.text).toMatch(/Đang xử lý câu hỏi trước/);
    release();
    await first;
    expect(r.sent[1]!.text).toBe('xong');
    const bad = rig({
      ask: async () => {
        throw new Error('runtime chết');
      },
    });
    await bad.bot.handleUpdate(msg(t, mention(t)));
    expect(bad.sent[0]!.text).toMatch(/Không trả lời được: runtime chết/);
  });
});

describe('inline buttons', () => {
  const cb = (data: string, from = ALICE, chatId = GROUP): TgUpdate => ({
    update_id: ++uid,
    callback_query: {
      id: `cb${uid}`,
      from,
      data,
      message: { message_id: 50, chat: { id: chatId, type: 'supergroup' } },
    },
  });
  it('routes by prefix, answers the query and can clear the keyboard', async () => {
    const r = rig();
    const seen: unknown[] = [];
    r.bot.onCallback('pub', async (data, c) => {
      seen.push([data, c.from.id, c.chat_id, c.message_id]);
      return { text: 'Đã hủy', clear_markup: true };
    });
    await r.bot.handleUpdate(cb('pub:cancel:pi_1'));
    expect(seen).toEqual([['cancel:pi_1', 11, GROUP, 50]]);
    expect(r.answers[0]).toMatchObject({ o: { text: 'Đã hủy' } });
    expect(r.edits).toHaveLength(1);
  });
  it('users who may not command the bot get an alert and the handler never runs', async () => {
    const r = rig({ allowed: ['11'] });
    let ran = false;
    r.bot.onCallback('pub', async () => void (ran = true));
    await r.bot.handleUpdate(cb('pub:now', BOB));
    expect(ran).toBe(false);
    expect(r.answers[0]).toMatchObject({ o: { show_alert: true } });
  });
  it('unknown prefix and failing handlers still answer the query', async () => {
    const r = rig();
    await r.bot.handleUpdate(cb('zzz:1'));
    expect(r.answers[0]!.o).toMatchObject({ text: expect.stringContaining('không còn') });
    r.bot.onCallback('bad', async () => {
      throw new Error('lỗi nút');
    });
    await r.bot.handleUpdate(cb('bad:1'));
    expect(r.answers[1]!.o).toMatchObject({ text: 'Lỗi: lỗi nút', show_alert: true });
  });
});

describe('poll loop', () => {
  it('persists the offset after each update and resumes from the stored offset', async () => {
    const seenOffsets: (number | undefined)[] = [];
    let n = 0;
    const r = rig({
      readOffset: () => 40,
      updates: (poll) =>
        poll === 1
          ? [
              { ...msg('/status'), update_id: 41 },
              { ...msg('/status'), update_id: 42 },
            ]
          : [],
    });
    const orig = r.bot['d'].client.getUpdates;
    r.bot['d'].client.getUpdates = async (o) => {
      seenOffsets.push((o as { offset?: number } | undefined)?.offset);
      n += 1;
      return orig(o);
    };
    r.bot.start();
    while (n < 3) await new Promise((res) => setTimeout(res, 5));
    await r.bot.stop();
    expect(r.offsets).toEqual([42, 43]);
    expect(seenOffsets.slice(0, 2)).toEqual([40, 43]);
    expect(r.sent).toHaveLength(2);
    expect(r.bot.status).toEqual({ state: 'stopped' });
  });
  it('network errors back off 1s, 2s, 4s… and recover without crashing', async () => {
    const net = new TelegramApiError('network', 'getUpdates', 'network error');
    const r = rig({ updates: (n) => (n <= 3 ? net : n === 4 ? [msg('/status')] : []) });
    r.bot.start();
    while (r.sent.length < 1) await new Promise((res) => setTimeout(res, 5));
    await r.bot.stop();
    expect(r.sleeps.slice(0, 3)).toEqual([1000, 2000, 4000]);
    expect(r.bot.status.state).toBe('stopped');
  });
  it('429 waits retry_after', async () => {
    const limited = new TelegramApiError('api', 'getUpdates', 'too many', 429, 7);
    const r = rig({ updates: (n) => (n === 1 ? limited : []) });
    r.bot.start();
    while (!r.sleeps.length) await new Promise((res) => setTimeout(res, 5));
    await r.bot.stop();
    expect(r.sleeps[0]).toBe(7000);
  });
  it('401 stops the bot with a clear reason; 409 too', async () => {
    const a = rig({
      updates: () => new TelegramApiError('api', 'getUpdates', '401 Unauthorized', 401),
    });
    a.bot.start();
    while (a.bot.status.state !== 'disabled') await new Promise((res) => setTimeout(res, 5));
    expect(a.bot.status).toMatchObject({ state: 'disabled', reason: 'token_invalid' });
    expect(a.polls()).toBe(1);
    const b = rig({
      updates: () => new TelegramApiError('api', 'getUpdates', '409 Conflict', 409),
    });
    b.bot.start();
    while (b.bot.status.state !== 'disabled') await new Promise((res) => setTimeout(res, 5));
    expect(b.bot.status).toMatchObject({
      state: 'disabled',
      reason: 'conflict',
      message: expect.stringContaining('409'),
    });
  });
  it('a handler that throws does not stop the loop, and the offset still advances', async () => {
    let first = true;
    const r = rig({
      updates: (n: number) =>
        n === 1
          ? [
              {
                update_id: 70,
                message: {
                  message_id: 1,
                  chat: { id: GROUP, type: 'supergroup' },
                  from: ALICE,
                  text: '/x',
                },
              },
              { ...msg('/status'), update_id: 71 },
            ]
          : [],
      commands: {
        x: async () => {
          throw new Error('x');
        },
        status: async () => 'ok',
      },
    } as never);
    // lỗi ở chính handleUpdate (không phải lệnh): làm getChatMember/identity ném
    const base = r.bot['d'].client.getMe;
    r.bot['d'].client.getMe = async () => {
      if (first) {
        first = false;
        return base();
      }
      return base();
    };
    r.bot.start();
    while (r.offsets.length < 2) await new Promise((res) => setTimeout(res, 5));
    await r.bot.stop();
    expect(r.offsets).toEqual([71, 72]);
  });
});
