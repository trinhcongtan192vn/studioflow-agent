# Data model — 002

Thực thể miền: **`docs/contracts/domain/d3.ts`** (trích từ D3) và `markdown.ts`. Không định nghĩa lại ở đây.

## Riêng của tính năng

| Thực thể | Trường | Ghi chú |
|---|---|---|
| `WriteLogEntry` | `path: RelPath, hash: Sha256, by: string, ts: Iso8601` | `by` = lối vào (`artifact.write`, `migration`, `channel.init`, `video.create`, `config.set`…) |
| `WriteResult` | `path, hash, backup?: RelPath` | |
| `Migration` | `kind: ArtifactKind, from: number, fn: (doc) => doc` | hàm thuần, `to = from + 1` |
| `ArtifactKind` | `brief, frame_md, story, script, storyboard, cast, publish, state, audio_meta, caption_groups, caption_overrides, lipsync, review_round, provenance, asset_manifest, render_record, channel, settings, output_profile, cast_member` | ánh xạ theo đường dẫn |
| `ValidationResult` | `{ valid, kind, errors: { code, path, message, line? }[] }` | `code` ∈ `E_SCHEMA_INVALID, E_PARSE_MARKER, E_ID_DUPLICATE, E_ID_UNKNOWN` |

## Kênh
`detectChannel(dir)` → `{ kind: 'channel', config } | { kind: 'not_channel' }`; `channel.json` hỏng → lỗi `E_SCHEMA_INVALID`.
