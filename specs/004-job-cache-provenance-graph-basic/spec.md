# Feature Specification: Job, cache, provenance, build graph cơ bản

**Feature Branch**: `004-job-cache-provenance-graph-basic`

**Created**: 2026-10-03

**Status**: Draft

**Input**: Backlog dòng 004: "job queue, cache theo nội dung, provenance, build graph cơ bản (nút `audio.line`, `asr.line`, `audio_meta`, `captions`, `frame_timing`, `index` + lan truyền lỗi thời)".

**Phủ yêu cầu**: FR-OP-01, FR-OP-03, FR-VO-04, FR-OB-02 (ghi provenance), NFR-02 (khôi phục job).

**Dựa trên `docs/`**: D4 mục 4.2 (adapter), 4.4 (định tuyến provider), 5 (job), 6 quy tắc 3–4 (thứ tự hàng đợi, pha), 7 (cache), 8 (build graph), 12 (`sf graph`, `sf job`) · D3 mục 5.7 (`audio_meta.json`), 5.12 (provenance), 8 (ghi) · D5 mục 5.1 (hỏi khi sinh hàng loạt) · tech-defaults mục 1 (SQLite), 3 (thử lại 3 lần, chờ 2 s rồi 10 s; hủy ≤ 5 s).

## Bối cảnh & mục tiêu

Việc nặng (TTS, ASR, render…) phải chạy dạng job có tiến độ/hủy/thử lại; kết quả sinh phải được cache theo nội dung và có provenance; sửa một phần video chỉ chạy lại phần bị ảnh hưởng. Tính năng này dựng hạ tầng chung đó: hàng đợi job bền (SQLite), bộ chạy capability (định tuyến provider, cache, provenance), và build graph với 6 loại nút cơ bản. Builder thật của từng nút (TTS 006, ASR/caption 010, index 011) đăng ký sau; 004 tự cài `audio_meta` (lắp ráp) và `frame_timing` (mô hình thời gian thuần).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Job có tiến độ, hủy, thử lại, kết quả từng phần (Priority: P1)

**Independent Test**: Đăng ký loại job giả; tạo job; theo dõi `job.updated`; hủy; lỗi retryable/không retryable; job cha có job con.

**Acceptance Scenarios**:

1. **Given** job đang chạy báo tiến độ, **Then** `JobInfo.progress` cập nhật và phát sự kiện `job.updated`; trạng thái lưu trong `studioflow.db`.
2. **Given** lỗi retryable, **Then** thử lại tới `max_attempts` (mặc định 3) với backoff; lỗi không retryable → `failed` ngay.
3. **When** `job.cancel`, **Then** adapter nhận abort, job `canceled` trong ≤ 5 s; job con chưa chạy bị hủy.
4. **Given** job cha có 3 con, 1 con lỗi, **Then** cha `partial`, kết quả 2 con thành công được giữ.
5. **Given** `core` tắt giữa lúc job `running`, **When** mở lại, **Then** job idempotent → `queued` (attempt giữ nguyên), không idempotent → `failed` `E_JOB_INTERRUPTED` (NFR-02).
6. **Given** nhiều job chờ, **Then** chọn theo ưu tiên (2 > 1 > 0) → cùng engine đang chạy gần nhất → thứ tự tạo; mỗi engine chạy một job một lúc.

---

### User Story 2 - Chạy capability có cache và provenance (Priority: P1)

**Independent Test**: Adapter giả đếm số lần chạy; chạy hai lần cùng đầu vào; đổi đầu vào; kiểm file đích, `provenance/*.json`, `from_cache`.

**Acceptance Scenarios**:

1. **Given** lần đầu, **Then** adapter chạy trong thư mục tạm, đầu ra được đưa vào đích qua module ghi, vào cache `<channel>/cache/objects/<2>/<key>/`, có provenance `from_cache: false` (FR-OB-02).
2. **Given** cùng đầu vào lần hai, **Then** adapter không chạy, đích có cùng nội dung, provenance `from_cache: true` (FR-OP-03).
3. **Given** đổi một phần trong `cacheKeyParts` (hoặc seed/provider_version), **Then** khóa khác → chạy lại.
4. **Given** capability `text.*` (temperature ≠ 0) hoặc `render.video`, **Then** không cache.
5. **Given** `provider.<capability>` trỏ provider không khả dụng và không có dự phòng phù hợp ngôn ngữ, **Then** `E_PROVIDER_UNAVAILABLE`; có dự phòng trong `settings.json.provider_fallbacks` → dùng dự phòng.
6. **Given** cache vượt `budget.cache_gb`, **When** dọn, **Then** xóa mục ít dùng nhất trước tới dưới hạn mức; chỉ xóa trong `cache/`.

---

### User Story 3 - Build graph: trạng thái và lan truyền lỗi thời (Priority: P1)

**Independent Test**: Video mẫu; builder giả cho `audio.line`/`asr.line`/`captions`/`index`; build toàn bộ → mọi nút `fresh`; sửa chữ một line → `graph.status`/`graph.plan`.

**Acceptance Scenarios**:

1. **Given** video chưa build, **Then** mọi nút `missing`; `graph.plan` liệt kê job theo pha `tts → asr → assemble`.
2. **Given** build xong, **Then** mọi nút `fresh`; `.sf/graph.json` có `{key, input_hash, output_hash, status, updated_at}` mỗi nút.
3. **Given** sửa `text` của một line, **Then** kế hoạch đúng `audio.line(ln)`, `asr.line(ln)`, `audio_meta`, `captions`, `frame_timing`, `index` (FR-VO-04); line khác vẫn `fresh`.
4. **Given** sửa `pause_after_ms` của một line, **Then** không sinh lại audio; `audio_meta`, `frame_timing`, `captions`, `index` lỗi thời.
5. **Given** builder của một nút lỗi, **Then** nút `failed`, nút phụ thuộc không chạy, job `graph.build` `partial`.
6. **Given** `graph.build` sẽ sinh nhiều hơn `policy.batch.tts_lines` line audio, **Then** hỏi người dùng (D5 mục 5.1) trừ khi `policy.auto_approve.batch_gen`.

---

### User Story 4 - Mô hình thời gian và `audio_meta.json` (Priority: P1)

**Acceptance Scenarios**:

1. **Given** độ dài các line, **Then** `audio_meta.json` có `start_ms` nối tiếp theo thứ tự SCRIPT cộng `pause_after_ms`, `total_duration_ms`, hợp lệ schema.
2. **Given** frame có line, **Then** thời lượng frame = Σ(`duration_ms` + `pause_after_ms`) của các line; frame không line → `frame.min_duration_ms`; frame có `min_duration_ms` → lấy giá trị lớn hơn; frame nối tiếp; transition chồng lên cuối frame trước (không làm dài video); mốc tuyệt đối của line = đầu frame + vị trí trong frame (D4 mục 8.3).

---

### User Story 5 - Tool và CLI (Priority: P2)

**Acceptance Scenarios**:

1. Tool `job.status/wait/cancel/list`, `graph.status/plan/build` đăng ký vào Gateway theo bảng D5 mục 4.
2. CLI `sf graph status|plan --channel <dir> --video <id>` (agent ✓), `sf job list`, `sf job cancel <id>`.

### Edge Cases

- `job.wait` hết thời gian → trả `JobInfo` hiện tại (chưa xong), không lỗi.
- Hủy job đã xong → không đổi gì.
- Đầu vào nút trỏ file không tồn tại (voice file) → nút `missing`/lỗi rõ khi build.
- `graph.json` hỏng/thiếu → coi như chưa build (dẫn xuất, dựng lại được).
- Hai `graph.build` cùng video → cái sau chờ cái trước (khóa theo video).

## Requirements *(mandatory)*

### Functional Requirements

**Job**
- **FR-001**: Hàng đợi job lưu `JobInfo` (D4 mục 5) trong bảng `jobs` của `<app-data>/studioflow.db`, ghi mỗi lần đổi trạng thái, phát `job.updated`.
- **FR-002**: Loại job đăng ký `{kind, engine?, idempotent, run(job, ctx)}`; `ctx` có `signal`, `progress(done,total,msg)`, `spawnChildren`.
- **FR-003**: Thử lại chỉ lỗi `retryable`, tối đa `max_attempts`, backoff 2 s rồi 10 s (cấu hình được cho test).
- **FR-004**: Hủy: abort, `canceled`, hủy job con chưa chạy; job đã kết thúc không đổi.
- **FR-005**: Job cha `partial` khi một số con lỗi; `succeeded` khi mọi con thành công; `failed` khi mọi con lỗi.
- **FR-006**: Khôi phục khi khởi động theo D4 mục 5.
- **FR-007**: Chọn job: ưu tiên → cùng engine vừa chạy → thứ tự tạo; một job mỗi engine; job không engine chạy song song tới giới hạn.

**Capability, cache, provenance**
- **FR-008**: Giao diện `ProviderAdapter`/`RunContext` theo D4 mục 4.2; registry provider; định tuyến theo D4 mục 4.4.
- **FR-009**: Khóa cache = sha256(canonical JSON {capability, contract_version, provider_id, provider_version, model_file_hash, input: cacheKeyParts, seed}); file đầu vào thay bằng hash nội dung.
- **FR-010**: Cache lưu `<channel>/cache/objects/<2>/<key>/` (+ `meta.json`), chỉ mục bảng `cache_entries`; trúng → chép (hard link nếu được) vào đích qua module ghi; không cache `text.*` (trừ temperature 0) và `render.video`.
- **FR-011**: Mỗi đầu ra ghi provenance `provenance/<12 ký tự đầu output_hash>.json` hợp lệ schema D3 5.12.
- **FR-012**: Dọn cache theo LRU dưới `budget.cache_gb` của kênh; chỉ xóa trong `cache/`.

**Build graph**
- **FR-013**: Nút và đầu vào theo D4 mục 8.1 cho `audio.line`, `asr.line`, `audio_meta`, `captions`, `frame_timing`, `index`; `input_hash` = hash các phần đầu vào.
- **FR-014**: Trạng thái `fresh | stale | missing | failed` (+ `pinned`, `pinned_stale` để dành cho `frame_html`, 020) lưu `.sf/graph.json`; nút có phụ thuộc không `fresh` là `stale`.
- **FR-015**: `graph.plan` trả job theo pha (`tts → asr → image → lipsync → assemble`), ước tính thời gian từ lịch sử và chi phí; `graph.build` chạy kế hoạch dưới một job `graph.build`: tiến độ theo nút, kết quả từng nút trong `result.nodes`, `partial` khi có nút lỗi; trước khi chạy một nút tính lại `input_hash`, khớp bản ghi và đầu ra còn → bỏ qua.
- **FR-016**: Builder nút đăng ký được từ tính năng khác; 004 cài builder `audio_meta` và `frame_timing`. Loại nút chưa có builder (ví dụ `asr.line` trước 010) được coi là **chưa kích hoạt**: không vào kế hoạch và không tính là phụ thuộc.
- **FR-017**: `graph.build` hỏi người dùng khi số `audio.line` cần sinh > `policy.batch.tts_lines` (D5 mục 5.1).

**Giao diện**
- **FR-018**: Tool `job.status/wait/cancel/list`, `graph.status/plan/build`; CLI `sf graph status|plan`, `sf job list|cancel`.

### Key Entities

`JobInfo`, `ProviderManifest`, hợp đồng capability (D4 mục 3–5, sinh trong `docs/contracts/gateway/d4.ts`); `Provenance`, `AudioMeta` (D3). Riêng: **GraphNode** `{id: "<type>:<key>", type, key, input_hash, output_hash, status, updated_at, meta?}`, **CacheEntry** `{key, channel, size, last_used}`.

## Success Criteria *(mandatory)*

- **SC-001**: Sửa một line → đúng 6 nút trong kế hoạch, không nút nào khác (FR-VO-04).
- **SC-002**: Chạy lại cùng đầu vào → 0 lần gọi adapter (FR-OP-03).
- **SC-003**: Giết tiến trình giữa lúc job chạy → khởi động lại đúng trạng thái theo D4 mục 5.
- **SC-004**: Độ phủ dòng `packages/core` ≥ 80%.

## Phạm vi

**Trong**: hàng đợi job + SQLite, registry provider + định tuyến, bộ chạy capability (cache, provenance), dọn cache, build graph 6 nút, builder `audio_meta`/`frame_timing`, tool + CLI.

**Ngoài**: lịch GPU đầy đủ (offload, ngân sách VRAM — 019), các nút `asset`, `frame_html`, `lipsync.line`, `credits`, `render` (020), builder TTS (006), ASR/caption (010), index (011), gom thay đổi lẻ từ chat (007/008), đĩa (024).

## Assumptions

- SQLite bằng `node:sqlite` có sẵn trong Node 22/Electron 37 (lệch tech-defaults `better-sqlite3`, lý do ở research).
- `voice files` của đầu vào `audio.line` = mọi file trong `voices/<voice_id>/` (hash nội dung).
- Ước tính thời gian = trung bình thời gian build nút cùng loại đã ghi trong `graph.json`; chưa có lịch sử → `null`.
