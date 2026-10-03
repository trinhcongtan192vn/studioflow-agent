# Data model — 004

Dùng nguyên văn: `JobInfo`, `ProviderManifest`, `CapabilityContract`, `TtsInput/TtsOutput`… (`docs/contracts/gateway/d4.ts`), `Provenance`, `AudioMeta` (D3).

## SQLite `studioflow.db`

```sql
CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT, video_id TEXT, channel_dir TEXT, status TEXT, engine TEXT,
  priority INTEGER, attempts INTEGER, max_attempts INTEGER, idempotent INTEGER, parent_id TEXT,
  payload TEXT, info TEXT /* JobInfo JSON */, created_at TEXT, updated_at TEXT);
CREATE TABLE cache_entries (key TEXT, channel TEXT, size INTEGER, last_used TEXT, PRIMARY KEY (key, channel));
```

## `.sf/graph.json`

```json
{ "schema_version": 1, "nodes": { "audio.line:ln_x": { "key": "ln_x", "type": "audio.line", "input_hash": "…", "output_hash": "…", "status": "fresh", "updated_at": "…", "ms": 1200, "meta": {} } } }
```

`NodeStatus` (trả bởi `graph.status`): `{id, type, key, status, reason?}`; `PlannedJob`: `{node, type, key, phase}`.
