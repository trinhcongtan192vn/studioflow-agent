// 052 · FR-AP-07, FR-AP-08 — bộ chạy Autopilot, phần thuần: cổng chất lượng thay điểm chốt (brief, story/script,
// finalize, bỏ qua cảnh báo thời lượng), đọc thời điểm hết hạn mức Claude (weekly/session, múi giờ), cổng
// khung giờ làm việc / tạm dừng / chờ hạn mức, thứ tự làm các mục.
import { describe, expect, it } from 'vitest';
import {
  decideBrief,
  decideDuration,
  decideFinalize,
  decideRefine,
} from '../../src/autopilot/gates.js';
import { briefInstruction } from '../../src/autopilot/brief.js';
import { limitResumeAt, parseLimit } from '../../src/autopilot/limit.js';
import type { PlanItem } from '../../src/contracts/types.js';
import { AUTO_APPROVAL_NOTE, isAutoApproval } from '../../src/domain/autopilot.js';
import {
  canonicalDir,
  orderItems,
  startGate,
  type QueueEntry,
} from '../../src/autopilot/runner.js';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const item = { workflow_id: 'narrated-explainer', output_profile: 'yt-1080p30' };

describe('decideBrief', () => {
  it('approves when BRIEF.md proposes the planned workflow and output profile', () => {
    const d = decideBrief(
      {
        proposed_workflow: { id: 'narrated-explainer' },
        proposed_output_profile: 'yt-1080p30',
      },
      item,
    );
    expect(d.approve).toBe(true);
    expect(d.reason).toMatch(/narrated-explainer/);
  });
  it('parks on a different workflow, a different profile or no proposal', () => {
    const wf = { proposed_workflow: { id: 'shorts' }, proposed_output_profile: 'yt-1080p30' };
    expect(decideBrief(wf, item).approve).toBe(false);
    expect(decideBrief(wf, item).reason).toMatch(/shorts/);
    expect(
      decideBrief(
        { proposed_workflow: { id: 'narrated-explainer' }, proposed_output_profile: 'yt-4k' },
        item,
      ).approve,
    ).toBe(false);
    expect(decideBrief({}, item).approve).toBe(false);
    expect(
      decideBrief({ proposed_workflow: null, proposed_output_profile: null }, item).approve,
    ).toBe(false);
  });
});

describe('decideRefine (story / script)', () => {
  it('approves a score at or above the threshold that is not incomplete', () => {
    const at = decideRefine({ rounds: 2, final_score: 8 }, { configured: true, threshold: 8 });
    expect(at.approve).toBe(true);
    expect(at.reason).toMatch(/8/);
    expect(
      decideRefine({ rounds: 1, final_score: 9.1 }, { configured: true, threshold: 8 }).approve,
    ).toBe(true);
  });
  it('parks a score below the threshold', () => {
    const d = decideRefine({ rounds: 3, final_score: 7.4 }, { configured: true, threshold: 8 });
    expect(d.approve).toBe(false);
    expect(d.reason).toMatch(/7[.,]4/);
    expect(d.reason).toMatch(/8/);
  });
  it('parks an incomplete refine even with a high score', () => {
    expect(
      decideRefine(
        { rounds: 3, final_score: 9, incomplete: true },
        { configured: true, threshold: 8 },
      ).approve,
    ).toBe(false);
  });
  it('parks when the step has a refine loop but no score was recorded', () => {
    expect(decideRefine(undefined, { configured: true, threshold: 8 }).approve).toBe(false);
    expect(decideRefine({ rounds: 0 }, { configured: true, threshold: 8 }).approve).toBe(false);
  });
  it('approves on the objective gates alone when the step has no refine loop', () => {
    const d = decideRefine(undefined, { configured: false, threshold: 8 });
    expect(d.approve).toBe(true);
    expect(d.reason).toMatch(/refine|chấm điểm/i);
  });
});

describe('decideFinalize', () => {
  it('approves with no ASR mismatch left', () => {
    expect(decideFinalize({ mismatched: [] }).approve).toBe(true);
  });
  it('parks listing the lines still mismatched', () => {
    const d = decideFinalize({ mismatched: ['ln_aaaa0001', 'ln_aaaa0002'] });
    expect(d.approve).toBe(false);
    expect(d.reason).toMatch(/ln_aaaa0001/);
    expect(d.reason).toMatch(/2/);
  });
});

describe('decideDuration (cảnh báo audio_duration, 043)', () => {
  it('waives a deviation within the ratio (both directions, boundary inclusive)', () => {
    expect(decideDuration({ actual_ms: 600_000, target_ms: 480_000, ratio: 0.25 }).approve).toBe(
      true,
    ); // +25 %
    expect(decideDuration({ actual_ms: 360_000, target_ms: 480_000, ratio: 0.25 }).approve).toBe(
      true,
    ); // −25 %
    expect(decideDuration({ actual_ms: 500_000, target_ms: 480_000, ratio: 0.25 }).approve).toBe(
      true,
    );
  });
  it('parks beyond the ratio, and reports the deviation', () => {
    const d = decideDuration({ actual_ms: 700_000, target_ms: 480_000, ratio: 0.25 });
    expect(d.approve).toBe(false);
    expect(d.reason).toMatch(/46/); // +45,8 %
    expect(decideDuration({ actual_ms: 300_000, target_ms: 480_000, ratio: 0.25 }).approve).toBe(
      false,
    );
  });
  it('a tighter ratio from settings is honoured', () => {
    expect(decideDuration({ actual_ms: 520_000, target_ms: 480_000, ratio: 0.05 }).approve).toBe(
      false,
    );
  });
  it('no target duration → nothing to compare, park rather than guess', () => {
    expect(decideDuration({ actual_ms: 520_000, target_ms: 0, ratio: 0.25 }).approve).toBe(false);
  });
});

describe('parseLimit (thông báo hết hạn mức Claude)', () => {
  const weekly =
    "Claude Code returned an error result: You've hit your weekly limit · resets 3am (Asia/Bangkok)";
  const session =
    "Claude Code returned an error result: You've hit your session limit · resets 8am (Asia/Bangkok)";

  it('reads the kind and the next reset in the message time zone (weekly)', () => {
    const r = parseLimit(weekly, new Date('2026-10-07T10:00:00Z'), 'Asia/Ho_Chi_Minh')!;
    expect(r.kind).toBe('weekly');
    expect(r.resets_at!.toISOString()).toBe('2026-10-07T20:00:00.000Z'); // 03:00 ngày 8, UTC+7
    expect(r.time_zone).toBe('Asia/Bangkok');
  });
  it('session limit: the next 8am', () => {
    const r = parseLimit(session, new Date('2026-10-07T20:30:00Z'), 'Asia/Ho_Chi_Minh')!;
    expect(r.kind).toBe('session');
    expect(r.resets_at!.toISOString()).toBe('2026-10-08T01:00:00.000Z');
  });
  it('a time already passed today means tomorrow', () => {
    const r = parseLimit(weekly, new Date('2026-10-07T21:00:00Z'), 'Asia/Ho_Chi_Minh')!; // 04:00 ngày 8
    expect(r.resets_at!.toISOString()).toBe('2026-10-08T20:00:00.000Z');
  });
  it('minutes, pm and another time zone', () => {
    const a = parseLimit(
      "You've hit your session limit · resets 3:30pm (Asia/Bangkok)",
      new Date('2026-10-07T00:00:00Z'),
      'UTC',
    )!;
    expect(a.resets_at!.toISOString()).toBe('2026-10-07T08:30:00.000Z');
    const b = parseLimit(
      "You've hit your session limit · resets 5pm (America/Los_Angeles)",
      new Date('2026-10-07T10:00:00Z'),
      'Asia/Ho_Chi_Minh',
    )!;
    expect(b.resets_at!.toISOString()).toBe('2026-10-08T00:00:00.000Z'); // PDT = UTC−7
  });
  it('12am / 12pm', () => {
    expect(
      parseLimit(
        "You've hit your session limit · resets 12am (UTC)",
        new Date('2026-10-07T10:00:00Z'),
        'UTC',
      )!.resets_at!.toISOString(),
    ).toBe('2026-10-08T00:00:00.000Z');
    expect(
      parseLimit(
        "You've hit your session limit · resets 12pm (UTC)",
        new Date('2026-10-07T10:00:00Z'),
        'UTC',
      )!.resets_at!.toISOString(),
    ).toBe('2026-10-07T12:00:00.000Z');
  });
  it('a dated reset (weekly)', () => {
    const r = parseLimit(
      "You've hit your weekly limit · resets Oct 12, 3am (Asia/Bangkok)",
      new Date('2026-10-07T10:00:00Z'),
      'Asia/Ho_Chi_Minh',
    )!;
    expect(r.resets_at!.toISOString()).toBe('2026-10-11T20:00:00.000Z');
  });
  it('no time zone in the message → the fallback zone', () => {
    const r = parseLimit(
      "You've hit your session limit · resets 8am",
      new Date('2026-10-07T20:30:00Z'),
      'Asia/Ho_Chi_Minh',
    )!;
    expect(r.resets_at!.toISOString()).toBe('2026-10-08T01:00:00.000Z');
  });
  it('a limit message without a readable time → kind but no reset time', () => {
    const r = parseLimit("You've hit your weekly limit", new Date('2026-10-07T10:00:00Z'), 'UTC')!;
    expect(r.kind).toBe('weekly');
    expect(r.resets_at).toBeNull();
  });
  it('anything else is not a limit message', () => {
    expect(parseLimit('E_PROVIDER_FAILED: boom', new Date(), 'UTC')).toBeUndefined();
    expect(parseLimit(undefined, new Date(), 'UTC')).toBeUndefined();
  });
});

describe('limitResumeAt', () => {
  const anchor = new Date('2026-10-07T10:00:00Z');
  it('reset time plus a one-minute margin', () => {
    const at = limitResumeAt(
      "You've hit your weekly limit · resets 3am (Asia/Bangkok)",
      anchor,
      'UTC',
    );
    expect(at.toISOString()).toBe('2026-10-07T20:01:00.000Z');
  });
  it('unreadable → one hour after the anchor', () => {
    expect(limitResumeAt("You've hit your weekly limit", anchor, 'UTC').toISOString()).toBe(
      '2026-10-07T11:00:00.000Z',
    );
  });
});

describe('startGate (tạm dừng, khung giờ làm việc, chờ hạn mức)', () => {
  const base = {
    paused: false,
    window: '08:00-23:00',
    timezone: 'Asia/Ho_Chi_Minh',
  };
  const inside = new Date('2026-10-07T03:00:00Z'); // 10:00
  const outside = new Date('2026-10-07T17:00:00Z'); // 00:00 ngày 8
  it('runs inside the work window', () => {
    expect(startGate({ ...base, now: inside })).toEqual({ ok: true });
  });
  it('does nothing new outside the work window', () => {
    expect(startGate({ ...base, now: outside })).toEqual({ ok: false, reason: 'outside_window' });
  });
  it('overnight window', () => {
    const g = { ...base, window: '22:00-06:00' };
    expect(startGate({ ...g, now: outside }).ok).toBe(true);
    expect(startGate({ ...g, now: inside }).ok).toBe(false);
  });
  it('paused wins over everything, even force', () => {
    expect(startGate({ ...base, paused: true, now: inside })).toEqual({
      ok: false,
      reason: 'paused',
    });
    expect(startGate({ ...base, paused: true, now: inside, force: true }).ok).toBe(false);
  });
  it('waiting for a Claude reset blocks until the time passes, even force', () => {
    const waitingUntil = new Date('2026-10-07T04:00:00Z');
    expect(startGate({ ...base, now: inside, waitingUntil })).toEqual({
      ok: false,
      reason: 'limit_wait',
    });
    expect(startGate({ ...base, now: inside, waitingUntil, force: true }).ok).toBe(false);
    expect(startGate({ ...base, now: new Date('2026-10-07T04:00:01Z'), waitingUntil }).ok).toBe(
      true,
    );
  });
  it('force ignores only the work window', () => {
    expect(startGate({ ...base, now: outside, force: true })).toEqual({ ok: true });
  });
});

describe('orderItems', () => {
  const e = (
    channel: string,
    index: number,
    id: string,
    status: string,
    publish_at: string | null,
  ): QueueEntry => ({
    channel,
    date: '2026-10-07',
    index,
    item: { id, status, publish_at } as QueueEntry['item'],
  });
  it('only planned and in_production items are queued', () => {
    const q = orderItems([
      e('/a', 0, 'pi_1', 'produced', null),
      e('/a', 1, 'pi_2', 'skipped', null),
      e('/a', 2, 'pi_3', 'failed', null),
      e('/a', 3, 'pi_4', 'needs_review', null),
      e('/a', 4, 'pi_5', 'planned', null),
    ]);
    expect(q.map((x) => x.item.id)).toEqual(['pi_5']);
  });
  it('resumes in_production first, then publish_at ascending across channels, nulls last', () => {
    const q = orderItems([
      e('/b', 0, 'pi_b1', 'planned', '2026-10-07T19:00:00+07:00'),
      e('/a', 0, 'pi_a1', 'planned', '2026-10-07T21:00:00+07:00'),
      e('/a', 1, 'pi_a2', 'planned', null),
      e('/b', 1, 'pi_b2', 'in_production', '2026-10-07T23:00:00+07:00'),
      e('/a', 2, 'pi_a3', 'planned', '2026-10-07T12:00:00+07:00'),
    ]);
    expect(q.map((x) => x.item.id)).toEqual(['pi_b2', 'pi_a3', 'pi_b1', 'pi_a1', 'pi_a2']);
  });
  it('compares instants, not strings (different offsets)', () => {
    const q = orderItems([
      e('/a', 0, 'pi_x', 'planned', '2026-10-07T19:00:00+07:00'), // 12:00Z
      e('/a', 1, 'pi_y', 'planned', '2026-10-07T13:00:00Z'),
      e('/a', 2, 'pi_z', 'planned', '2026-10-07T11:00:00Z'),
    ]);
    expect(q.map((x) => x.item.id)).toEqual(['pi_z', 'pi_x', 'pi_y']);
  });
  it('ties keep channel then plan order (stable)', () => {
    const q = orderItems([
      e('/b', 0, 'pi_b', 'planned', null),
      e('/a', 1, 'pi_a2', 'planned', null),
      e('/a', 0, 'pi_a1', 'planned', null),
    ]);
    expect(q.map((x) => x.item.id)).toEqual(['pi_a1', 'pi_a2', 'pi_b']);
  });
});

describe('isAutoApproval (034 + 052)', () => {
  it('Autopilot gate approvals count as automatic; a parked note does not', () => {
    expect(isAutoApproval({ note: 'Autopilot: điểm 9 ≥ ngưỡng 8' })).toBe(true);
    expect(isAutoApproval({ note: `${AUTO_APPROVAL_NOTE} — tóm tắt` })).toBe(true);
    expect(isAutoApproval({ note: 'Cần người duyệt (Autopilot): điểm 6' })).toBe(false);
    expect(isAutoApproval({ note: 'Ngắn hơn một chút' })).toBe(false);
    expect(isAutoApproval({})).toBe(false);
  });
});

describe('briefInstruction (chỉ dẫn lên brief cho phiên main)', () => {
  const base = {
    title: 'Trận Bạch Đằng 1288',
    angle: 'Đối thủ vừa đăng: gấp 15× lượt xem',
    workflow_id: 'narrated-explainer',
    output_profile: 'yt-1080p30',
  };
  it('a YouTube source: analyse the video, write REFERENCE.md + BRIEF.md formula, then select the planned workflow', () => {
    const t = briefInstruction(
      {
        ...base,
        source: {
          kind: 'competitor',
          url: 'https://www.youtube.com/watch?v=aaaaaaaaa01',
          source_channel: { id: 'UCa', title: 'Sử Kể Mẫu' },
        },
      } as PlanItem,
      '2026-10-07',
    );
    expect(t).toMatch(/^\[Autopilot\]/);
    expect(t).toContain('youtube.video');
    expect(t).toContain('youtube.transcript');
    expect(t).toContain('REFERENCE.md');
    expect(t).toContain('Công thức tham khảo');
    expect(t).toContain(
      'workflow.select {workflow_id: "narrated-explainer", output_profile: "yt-1080p30"}',
    );
    expect(t).toContain('Sử Kể Mẫu');
  });
  it('a trend/news source has no video to analyse', () => {
    const t = briefInstruction({ ...base, source: { kind: 'news' } } as PlanItem, '2026-10-07');
    expect(t).not.toContain('REFERENCE.md');
    expect(t).not.toContain('Công thức tham khảo');
    expect(t).toContain('tin nóng');
    expect(t).toContain('workflow.select');
  });
});

describe('canonicalDir (052, Windows 8.3)', () => {
  it('maps short/long spellings of one folder to the same key; missing folder → resolved path', () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'sf-canon-'));
    try {
      const real = realpathSync.native(d);
      expect(canonicalDir(d)).toBe(real);
      expect(canonicalDir(real)).toBe(real);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
    expect(canonicalDir('khong-co/thu-muc')).toBe(path.resolve('khong-co/thu-muc'));
  });
});
