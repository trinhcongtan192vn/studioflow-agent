# 045 — Khóa Studio còn sót & cảnh báo khi đóng app

## Vấn đề
Bước Dựng shot của "Cậu bé và con trâu" lỗi lặp lại (`missing data-sf-id` cho layer miệng). Thật ra mọi lần frame agent ghi file đều bị từ chối `E_OWNER_CONFLICT`: phiên sửa Studio mở hôm trước, app bị đóng khi phiên còn chạy → `state.json.owner = 'studio'` ở lại mãi, không còn phiên nào để đóng.

## Yêu cầu
- FR-ST-45-01: `video.open` → `StudioEdits.recoverStale`: không có phiên Studio đang chạy mà `owner = 'studio'` → nhả khóa. Bản làm việc không có thay đổi chưa commit → xóa; có → giữ lại, báo trong chat (dòng `system`). D9 mục 3.
- FR-ST-45-02: `app.activity` (IPC) liệt kê việc chạy dở: phiên Studio sửa, bước workflow đang chạy, job đang chạy, agent đang trả lời.
- FR-ST-45-03: Đóng cửa sổ / thoát app (nút đóng, Alt+F4, menu) → giao diện hỏi `app.activity`; có việc chạy dở → hộp "Còn việc đang chạy dở" (Ở lại / Vẫn đóng app); không có → đóng ngay. Giao diện không trả lời trong 4 s → vẫn đóng (không kẹt khi treo).

## AC
- `studio-stale-owner.test.ts`: khóa sót được nhả; bản làm việc không đổi bị xóa; có thay đổi → giữ + báo; agent sở hữu → không làm gì.
- `host.test.ts`: chat đang trả lời có trong `app.activity`, xong thì hết.
- `close-format.test.ts`: dòng cảnh báo cho từng loại việc.
