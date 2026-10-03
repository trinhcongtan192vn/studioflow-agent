# Feature Specification: Vỏ desktop, chat, explorer, tiến độ, job

**Feature Branch**: `008-desktop-shell-chat` · **Created**: 2026-10-04 · **Status**: Draft

**Input**: Backlog dòng 008: "chat, explorer chỉ đọc, tiến độ workflow, job panel". **Phủ**: FR-CH-02, FR-CH-03, FR-CH-07, FR-WS-02 (+ màn UI-01 của 014, UI-08 của 015, UI-07 cơ bản của 012).

**Dựa trên `docs/`**: D10 (màn hình, quy tắc, thẻ, IPC) · D4 mục 1 (tiến trình `main`/`renderer`/`core`) · D5 mục 1, 5.4 (phiên `main`, bí mật ở `main`) · D3 mục 5.16 (chat log) · FN-008 · tech-defaults mục 1 (`utilityProcess`, MessagePort).

## User Scenarios & Testing
### US1 — Mở kênh, video (P1)
UI-02: kênh gần đây, mở thư mục kênh, tạo kênh. UI-03: thanh trái (video, "Video mới", explorer), chat, panel phải (Tiến độ, Xem trước, Job, Nhạc, Trace), thanh trạng thái.
### US2 — Chat (P1) — FR-CH-02/03/07
Luồng trả lời; tool call dạng dòng gọn (tên thân thiện + tóm tắt, mở rộng xem input); thẻ duyệt (từ `approval.requested`: tên bước, tóm tắt refine, Duyệt / Yêu cầu sửa + ghi chú) và thẻ xác nhận (Đồng ý / Từ chối / Luôn cho phép); đính kèm qua `upload.ingest` (loại cho phép, ≤ 200 MB); lịch sử `chat/<session_id>.jsonl` theo video, mở lại tiếp tục phiên `main` (`resume`). Ctrl+Enter gửi, Esc dừng.
### US3 — Explorer chỉ đọc (P1) — FR-WS-02
Cây thư mục kênh (bỏ `cache/`, `.sf/`); xem tệp (Markdown/văn bản, JSON dạng cây, nhị phân: kích thước); chuột phải mở thư mục trong Windows. Không có thao tác sửa/xóa/đổi tên.
### US4 — Tiến độ, Job, Trace, Nhạc, Cài đặt, Onboarding (P1)
Tiến độ từ `workflow.yaml` + `state.json` (không mã riêng theo workflow); chọn workflow khi briefing; chạy tới/quay lại bước. Job: bảng, hủy, thử lại, cập nhật theo `job.updated`. Trace: danh sách → cây span. Nhạc: danh sách, tìm, nạp. Cài đặt: khóa API (4 ký tự cuối) qua `main`, model viết. Onboarding: trạng thái đăng nhập, hồ sơ cài đặt + dung lượng, tải.
### US5 — Lõi tách tiến trình (P1)
`core` chạy trong Electron `utilityProcess`; renderer ↔ core JSON-RPC 2.0 qua MessagePort do `main` cấp; `core` thoát → lớp phủ "Đang khởi động lại lõi…", tự khởi động lại tối đa 3 lần. Bí mật do `main` đọc Credential Manager và chuyển cho `core`.

## Requirements
- **FR-001** `packages/core/src/ipc/schema.ts` (phương thức/sự kiện D10 mục 4). **FR-002** `CoreHost` + entry `host-entry`. **FR-003** `main`/`preload` (utilityProcess, MessagePort, hộp thoại, bí mật). **FR-004** renderer React (màn/tab trên). **FR-005** chat log + resume. **FR-006** replay agent tạo span phiên.

## Success Criteria
- **SC-001** Test UI thật (Playwright + Electron): mở kênh, explorer xem tệp, chat với Claude (ghi/phát lại) trả lời đúng, tab Trace có `sf.agent.session`, mở lại app còn lịch sử.

## Ngoài phạm vi
Studio nhúng (017), ngữ cảnh Alt+click (M3), bảng caption (026), dung lượng (024), báo cáo chi phí (028), Markdown render đầy đủ (hiển thị văn bản thuần).
