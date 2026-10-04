import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, video_id TEXT, channel_dir TEXT, status TEXT NOT NULL,
  engine TEXT, priority INTEGER NOT NULL, idempotent INTEGER NOT NULL, parent_id TEXT,
  not_before INTEGER NOT NULL DEFAULT 0, payload TEXT, info TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE TABLE IF NOT EXISTS cache_entries (
  key TEXT NOT NULL, channel TEXT NOT NULL, size INTEGER NOT NULL, last_used TEXT NOT NULL,
  PRIMARY KEY (key, channel)
);
CREATE TABLE IF NOT EXISTS spans (
  span_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL,
  start_ms REAL NOT NULL, end_ms REAL NOT NULL, status TEXT NOT NULL, status_message TEXT,
  video_id TEXT, attrs TEXT NOT NULL, events TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS spans_trace ON spans(trace_id);
CREATE INDEX IF NOT EXISTS spans_video ON spans(video_id, start_ms);
CREATE TABLE IF NOT EXISTS usage (
  ts TEXT NOT NULL, channel_id TEXT, video_id TEXT, step_id TEXT, kind TEXT NOT NULL,
  provider TEXT, model TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  units REAL NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, source TEXT NOT NULL,
  span_id TEXT, trace_id TEXT
);
CREATE INDEX IF NOT EXISTS usage_video ON usage(video_id, step_id);
`;

/** `<app-data>/studioflow.db` (D3 mục 1): bảng `jobs` (D4 mục 5), `cache_entries` (D4 mục 7), `spans` (D11 mục 1), `usage` (D11 mục 3, 028). */
export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}
