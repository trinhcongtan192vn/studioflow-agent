# 064 — Xóa video vào thùng rác của kênh

## Yêu cầu của Tan (2026-10-07)
Cho phép xóa video đã tạo trong kênh, đỡ rác. Chọn: thùng rác của app, tự dọn sau 30 ngày.

## Constitution
Điều VI cấm xóa trong project → **sửa constitution lên 1.1** (07/10/2026): ngoại lệ "xóa video theo yêu cầu người dùng" = chuyển vào `<kênh>/.trash/` (vẫn trong project, khôi phục được); chỉ nội dung `.trash/` được xóa hẳn — quá `trash.retention_days` ngày (mặc định 30) hoặc khi người dùng bấm "Dọn thùng rác". Đã chép sang `.specify/memory/constitution.md`.

## Yêu cầu
- FR-WS-64-01: Module ghi: `moveDir` (chỉ `videos/<vd>` ↔ `.trash/<vd>-<YYYYMMDDHHmmss>`), `purgeTrash` (chỉ `.trash/<id>`).
- FR-WS-64-02: IPC `video.delete` (video đang chạy bước / mở Studio / agent đang trả lời / Autopilot đang làm → `E_VIDEO_BUSY`), `trash.list`, `trash.restore` (trùng id → `E_ID_DUPLICATE`), `trash.empty`. Mở kênh → dọn mục quá hạn. Khóa `trash.retention_days` (app, channel).
- FR-UI-64-03: Nút 🗑 trên từng video (hiện khi rê chuột) + hộp xác nhận; "Thùng rác (N)" cuối sidebar: Khôi phục, Dọn thùng rác (xác nhận).

## AC
- `video-trash.test.ts`, `host.test.ts` (xóa/khôi phục/dọn, chặn khi đang bận), UI: xóa → thùng rác → khôi phục.
