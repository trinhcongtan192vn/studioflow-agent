# Feature Specification: Studio xem trước nhúng trong app

**Feature Branch**: `017-studio-preview` · **Created**: 2026-10-04 · **Status**: Draft

**Input**: Backlog dòng 017: "nhúng Studio chế độ xem". **Phủ**: FR-ST-01 (+ một phần S6). **Dựa trên**: D9 mục 1–2 · D4 mục 1 (`hf-studio`), 2.4 (`studio.open/close`) · D10 UI-05.

## User Scenarios & Testing
### US1 — Xem trước (P1) — FR-ST-01
`studio.open {mode:'preview'}` chạy `hyperframes preview` bản ghim (cổng ngẫu nhiên 127.0.0.1) cho video; tab "Xem trước" nhúng Studio (iframe), "Mở rộng" toàn màn; tự tải lại khi `index.html`/`compositions/`… đổi; `studio.close` dừng tiến trình. Video chưa có `index.html` → `E_FILE_NOT_FOUND`.
### US2 — Chỉ đọc (P1)
Studio không bao giờ ghi vào project: chạy trên bản chụp `.sf/studio-preview/<vd>/` (file cảnh chép qua module ghi, `public/`, `audio/` là junction). Không đổi `owner`. `mode:'edit'` → `E_TOOL_DENIED` (M3, 025).

## Requirements
- **FR-001** `studio/preview.ts` (`syncSnapshot`, `StudioPreviews.open/close/closeAll`, theo dõi file cảnh). **FR-002** `WriteStore.linkDir` (junction chỉ trong `.sf/`). **FR-003** tool + IPC `studio.open/close`. **FR-004** tab Xem trước nhúng Studio, CSP `frame-src http://127.0.0.1:*`.

## Success Criteria
- **SC-001** Studio thật trả trang; file gốc không đổi sau khi Studio mở; sửa frame gốc → bản chụp đồng bộ < 10 s; đóng → cổng tắt. **SC-002** Test UI: iframe Studio trong app.

## Ngoài phạm vi
Chế độ chỉnh, read-back, nút ghim (025), bảng caption (026), ẩn trình sửa mã (S6 phần chỉnh).
