# CLI — 002 (quy ước D4 mục 12)

| Lệnh | stdout (exit 0) | Lỗi |
|---|---|---|
| `sf artifact validate <path>` | `{"valid":true,"kind":"script","errors":[]}` | không hợp lệ → exit 1, stderr `{code, message, details: errors[]}`; đường dẫn không thuộc loại artifact nào → exit 2 `E_CLI_USAGE` |
| `sf artifact migrate <video_dir> [--dry-run]` | `{"dry_run":bool,"migrated":[{path,from,to,backup?}]}` | `E_SCHEMA_TOO_NEW` exit 1 |
| `sf config resolve <key> --channel <dir> [--video <vd>] [--scene <sc>] [--frame <fr>]` | `ResolvedValue` | `E_CONFIG_UNKNOWN_KEY` exit 1 |

`details` là trường tùy chọn của dòng lỗi stderr (mở rộng tương thích của `{code, message}`).
