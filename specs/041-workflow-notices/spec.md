# 041 — Agent báo tình trạng workflow trong chat

## Vấn đề
Tình trạng làm video chỉ hiện ở tab Tiến độ; khung chat không cho biết bước nào đang chạy, xong, chờ duyệt hay lỗi, nên người dùng không biết cần làm gì.

## Yêu cầu
- FR-CH-41-01: Mỗi khi bước workflow đổi trạng thái, core ghi một dòng `assistant` có trường `notice` vào lịch sử chat của video (D3 5.16) và phát sự kiện IPC `workflow.notice`. Xong X rồi chạy Y ngay sau thì gộp thành một tin; bước cuối xong thì thêm tin "render xong".
- FR-CH-41-02: Giao diện vẽ thông báo thành thẻ có nút hợp với tình trạng: xong → xem kết quả / xem trước; chờ duyệt → **Duyệt** + xem tệp (không còn chờ → "Đã xử lý"); lỗi → lỗi dễ hiểu + Kiểm tra lại / Chạy lại / gợi ý giọng; render xong → Xem video.
- FR-CH-41-03: Bỏ thẻ bước phía giao diện (`changedSteps`) để không trùng; mở lại video mà bước đang lỗi chưa có thông báo trong lịch sử thì vẫn hiện thẻ lỗi.

## AC
- Unit: `workflowNotices`/`noticeText` (core), `noticeCtas` (desktop).
- Integration: duyệt brief → có `workflow.notice`, và `chat.history` chứa dòng `notice`.
