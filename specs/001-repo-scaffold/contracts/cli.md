# Contract — khung CLI `sf`

Quy ước chung: `docs/04-spec-capability-gateway.md` mục 12 (không định nghĩa lại). Phần dưới là bề mặt riêng của 001.

| Lệnh | Đầu vào | stdout (exit 0) |
|---|---|---|
| `sf --version` | — | `{"name":"studioflow","version":"<semver>"}` |
| `sf --help` | — | `{"commands":[{"module","name","summary"}...]}` |
| `sf diag echo --message <s> [--repeat <n>]` | hoặc stdin `{"message":s,"repeat":n}` | `{"message":s,"repeat":n,"echo":[s×n]}` |
| `sf diag fail` | — | (stderr `{"code":"E_DIAG_FAIL",...}`, exit 1) |
| `sf test <type>` | `type ∈ contract,integration,e2e,gpu,ui,unit` | `{"type", "projects":[{name, status}]}` |

Đầu vào JSON stdin: chỉ đọc khi stdin không phải TTY **và** có cờ `--json` (tránh treo khi bị gọi không có stdin). Tham số dòng lệnh ghi đè trường trùng tên trong JSON.

Lỗi: stderr đúng một dòng JSON `{"code","message"}`; stdout rỗng.
