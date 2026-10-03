# Research — 004

## R1. SQLite
- **Decision**: `node:sqlite` (`DatabaseSync`), WAL, một kết nối mỗi tiến trình `core`. Cảnh báo ExperimentalWarning bị lọc trong `bin/sf.mjs` và khi `core` khởi động để stderr CLI chỉ có JSON lỗi (D4 mục 12).
- **Alternatives**: `better-sqlite3` (tech-defaults) — cần addon native khớp ABI Electron; giữ làm phương án dự phòng nếu `node:sqlite` đổi API.

## R2. Lập lịch job ở 004
- **Decision**: một job/engine; job không engine song song tối đa 4; chọn theo ưu tiên → engine vừa chạy → `created_at`. Ngân sách VRAM/offload là 019.

## R3. Cache
- **Decision**: khóa theo D4 mục 7; đối tượng lưu bằng `WriteStore.write` (cache nằm trong kênh — Điều VI); đưa vào đích bằng `WriteStore.copyWithin` (thử hard link, không được thì chép nguyên tử). Dọn bằng `WriteStore.removeDerived` chỉ cho phép `cache/**` và `**/.sf/**`.

## R4. Build graph
- **Decision**: nút định danh `<type>:<key>` (`audio.line:ln_x`, `audio_meta`, …). `input_hash` gồm phần đầu vào D4 8.1 + `output_hash` đã ghi của nút phụ thuộc; trạng thái hiệu lực = `stale` nếu bất kỳ phụ thuộc nào không `fresh` (lan truyền). Builder trả `{outputs: RelPath[], meta?}`; `output_hash` = hash gộp các file đầu ra (hoặc của `meta` với `frame_timing`).
- **frame_timing** lưu trong `graph.json` (`meta.frames[]`, `meta.lines[]`) theo D4 8.1.
- **Pha** (D4 mục 6 quy tắc 4): `audio.line`→tts, `asr.line`→asr, `audio_meta|captions|frame_timing|index`→assemble.

## R5. Sửa sau (2026-10-03, trong nhánh 006)
- `graph.status`/`graph.plan` ban đầu trả hình dạng tự đặt; đã sửa theo D4 mục 3.1 (`NodeStatus {key, type, status}`, `PlannedJob {kind, targets, phase, est_ms, est_cost_usd, from_cache}`, `PlanEstimate`). Dạng nội bộ giữ ở `nodeStates()`/`planNodes()`.
