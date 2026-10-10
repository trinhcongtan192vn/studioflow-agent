// Hẹn giờ ngủ đông máy sau khi xong hết việc (2026-10-10).
import { describe, expect, it } from 'vitest';
import {
  clampMinutes,
  hibernateLabel,
  idleTick,
  isBusy,
} from '../../src/renderer/hibernate-format';

const idle = { steps: [], jobs: [], queued: 0, chats: [] };

describe('isBusy', () => {
  it('running steps, running or queued jobs and replying chats count as work', () => {
    expect(isBusy(idle)).toBe(false);
    expect(isBusy({ ...idle, steps: [{}] })).toBe(true);
    expect(isBusy({ ...idle, jobs: [{}] })).toBe(true);
    expect(isBusy({ ...idle, queued: 2 })).toBe(true);
    expect(isBusy({ ...idle, chats: [{}] })).toBe(true);
    // lõi cũ chưa có `queued`
    expect(isBusy({ steps: [], jobs: [], chats: [] })).toBe(false);
  });
});

describe('idleTick', () => {
  it('starts counting when work ends and is due after X minutes of continuous idle', () => {
    let t = idleTick(null, true, 0, 10);
    expect(t).toEqual({ idleSince: null, due: false, leftMs: null });
    t = idleTick(t.idleSince, false, 1000, 10);
    expect(t).toEqual({ idleSince: 1000, due: false, leftMs: 600_000 });
    t = idleTick(t.idleSince, false, 1000 + 599_000, 10);
    expect(t).toMatchObject({ due: false, leftMs: 1000 });
    t = idleTick(t.idleSince, false, 1000 + 600_000, 10);
    expect(t).toMatchObject({ due: true, leftMs: 0 });
  });
  it('new work in between resets the count', () => {
    let t = idleTick(null, false, 0, 1);
    t = idleTick(t.idleSince, true, 50_000, 1);
    t = idleTick(t.idleSince, false, 70_000, 1);
    expect(t).toEqual({ idleSince: 70_000, due: false, leftMs: 60_000 });
  });
});

it('clampMinutes keeps 1–720 with 15 by default', () => {
  expect(clampMinutes('30')).toBe(30);
  expect(clampMinutes(0)).toBe(15);
  expect(clampMinutes('abc')).toBe(15);
  expect(clampMinutes(5000)).toBe(720);
});

it('hibernateLabel shows off, waiting for work, or the time left', () => {
  expect(hibernateLabel(false, 15, null)).toBe('Ngủ đông: tắt');
  expect(hibernateLabel(true, 15, idleTick(null, true, 0, 15))).toContain(
    'đang chờ việc chạy xong',
  );
  expect(hibernateLabel(true, 15, idleTick(0, false, 65_000, 15))).toBe(
    'Hết việc — ngủ đông sau 13:55',
  );
});
