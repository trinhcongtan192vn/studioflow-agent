# D10 — Spec UI: danh mục màn hình và hợp đồng IPC

**Phiên bản:** 1.2 · **Ngày:** 03/10/2026
**Dựa trên:** D1 mục 7 (hành trình), D4–D9
**Phủ:** FR-WS-02, FR-CH-02/03/04/07, FR-WF-02/03, FR-SC-03/06, FR-OP-06, FR-OB-03 · **Tính năng:** 008, 014, 024, 026, 028

Tài liệu này chỉ chốt **những gì mọi tính năng UI phải tuân theo**: danh mục màn hình, quy tắc giao diện chung, nội dung bắt buộc của thẻ duyệt/xác nhận, và hợp đồng IPC. Bố cục, tương tác chi tiết, phím tắt: FN-008 và ghi chú của từng tính năng.

---

## 1. Danh mục màn hình

| Mã | Màn | Nội dung chính | GĐ |
|---|---|---|---|
| UI-01 | **Onboarding** | Chào → đăng nhập Claude (trạng thái `authStatus`) → chọn hồ sơ cài đặt (Tối thiểu/Chuẩn/Đầy đủ, hiện dung lượng) → tiến độ tải từng thành phần (tạm dừng/tiếp tục) → (tùy chọn) khóa OpenAI/DeepSeek/API ảnh → xong | M1 |
| UI-02 | **Trang chủ** | Danh sách kênh gần đây; "Mở thư mục kênh"; "Tạo kênh mới" (chọn thư mục → mở chat khởi tạo kênh) | M1 |
| UI-03 | **Không gian kênh** | Thanh trái (kênh, video, explorer), chat, panel phải theo tab (bố cục: FN-008); chọn video trong thanh trái; "Video mới" | M1 |
| UI-04 | **Tab Tiến độ** | Danh sách bước từ `workflow.yaml` + `state.json`: biểu tượng trạng thái, thời gian, nút "Chạy lại bước", "Quay lại bước này"; với bước có refine: số vòng, điểm cuối, nhãn "chưa đủ vòng" | M1 |
| UI-05 | **Tab Xem trước** | Studio nhúng (preview/edit); nút "Chỉnh trong Studio" (M3) / "Lưu" / "Đóng"; nút "Render nháp", "Render phát hành" | M1/M3 |
| UI-06 | **Tab Job** | Bảng job: loại, video, trạng thái, tiến độ, engine, thời gian; hủy, thử lại; lọc theo video | M1 |
| UI-07 | **Tab Nhạc** | Kho nhạc (app + kênh): bảng bài (tên, thời lượng, BPM, energy, tag, nguồn), nghe thử, sửa tag/ghi công, kéo thả để nạp, ô tìm (dùng `music.find`) | M1 |
| UI-08 | **Tab Trace** | Danh sách lần chạy (bước/phiên) → cây span, thời gian, token, chi phí; nút "Mở trong Phoenix" khi bật | M1 (đơn giản), M3 |
| UI-09 | **Cài đặt** | Tài khoản (Claude, khóa API — chỉ hiện 4 ký tự cuối); Provider theo capability; Model viết/critic/phụ mặc định; Hồ sơ cài đặt + model đã cài (gỡ); Ngân sách mặc định; Mạng cho phép; Thư mục dữ liệu | M1 |
| UI-10 | **Dung lượng** | Theo kênh: cache, render, sao lưu; model; nút dọn từng mục (hiện dung lượng sẽ giải phóng) | M2 |
| UI-11 | **Bảng caption** | D9 mục 6 | M3 |
| UI-12 | **Báo cáo chi phí** | Theo video và bước: token vào/ra, chi phí API, thời gian GPU; so ngân sách | M3 |

## 2. Quy tắc chung (ràng buộc)
- Ngôn ngữ giao diện tiếng Việt; thông báo lỗi lấy từ Gateway.
- Explorer **chỉ đọc**: không có thao tác tạo/sửa/xóa/đổi tên file trong project (FR-WS-02).
- UI không bao giờ ghi file project trực tiếp; mọi thay đổi đi qua IPC tới `core` (module ghi của Gateway).
- UI tiến độ workflow dựng từ `workflow.yaml` + `state.json`; **không có mã UI riêng cho từng workflow** (FR-WF-02).
- Thao tác dài không khóa toàn UI; trạng thái job lấy từ sự kiện `job.updated`.
- Khóa API chỉ hiển thị 4 ký tự cuối; nhập khóa đi thẳng tới `main` (Credential Manager).

## 3. Thẻ trong chat (nội dung bắt buộc)
- **Thẻ duyệt** (từ `approval.requested`): tên bước; tóm tắt (bước có refine: điểm từng vòng, vấn đề đã sửa/còn lại, nhãn "chưa đủ vòng"/"critic cùng hãng" nếu có); link xem artifact; hành động **Duyệt**, **Yêu cầu sửa** (kèm ghi chú), **Quay lại bước trước** → `approval.decide` / `workflow.rewind`.
- **Thẻ xác nhận** (từ `permission.requested`): hành động, ước tính số lượng/thời gian/chi phí; **Đồng ý** / **Từ chối**; "Luôn cho phép trong video này" khi chính sách cho phép (D5 mục 5.1) → `permission.decide`.
- **Đính kèm:** gọi `upload.ingest`; giới hạn 200 MB/file (`E_UPLOAD_TOO_LARGE`); loại file cho phép: ảnh, audio, văn bản (danh sách cụ thể: FN-008).
- **Ngữ cảnh** (M3): gửi dưới dạng `context_refs` (D5 mục 1).

## 4. IPC renderer ↔ core (hợp đồng)

JSON-RPC 2.0 (kênh truyền: tech-defaults). Phương thức (renderer gọi) và sự kiện (core đẩy):

| Phương thức | Mô tả |
|---|---|
| `app.status` | Trạng thái cài đặt, đăng nhập, engine |
| `channel.open` / `channel.init` / `channel.list_recent` | |
| `video.list` / `video.create` / `video.open` | |
| `chat.send` / `chat.interrupt` / `chat.history` | |
| `upload.ingest` | `{path_on_disk}` → `{rel_path}`; chép qua module ghi của Gateway |
| `approval.decide` | `{approval_id, decision, note?}` |
| `permission.decide` | `{request_id, allow, remember?}` |
| `workflow.run_to` / `workflow.pause` / `workflow.rewind` / `workflow.run_step` | |
| `job.list` / `job.cancel` / `job.retry` | |
| `studio.open` / `studio.commit` / `studio.close` | |
| `captions.load` / `captions.save` | |
| `music.list` / `music.add` / `music.update` / `music.find` | |
| `settings.get` / `settings.set` / `secrets.set` / `secrets.delete` | Khóa chuyển cho `main` lưu |
| `asr.accept` | Chấp nhận line lệch ASR |
| `install.plan` / `install.start` / `install.pause` | |
| `disk.usage` / `disk.clean` | |
| `trace.list` / `trace.get` / `cost.report` | |

| Sự kiện | Dữ liệu |
|---|---|
| `chat.event` | `AgentEvent` (D5) + `session_id` |
| `job.updated` | `JobInfo` |
| `workflow.updated` | `VideoState` rút gọn |
| `approval.requested` / `permission.requested` | thẻ (`permission.requested` mang `request_id` dùng cho `permission.decide`) |
| `artifact.changed` | `{path, hash, by}` |
| `install.progress` | `{component, done, total}` |
| `core.health` | `{ok, engines}` |

Tên đầy đủ tham số và kiểu trả về được sinh từ `packages/core/ipc/schema.ts` (tính năng 008), phải khớp bảng này.
