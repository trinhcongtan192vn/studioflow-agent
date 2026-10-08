# 084 — Nạp nhạc hàng loạt từ giao diện (kho kênh hoặc kho app)

## Bối cảnh
Tan muốn nạp ~1000 bài. Tab Nhạc chỉ nạp được vào kho kênh, chọn từng file; mỗi file bị chép thêm vào
`uploads/` của kênh (đầy ổ, không dọn) và tên bài mất (thành UUID) vì chép qua tên ngẫu nhiên.

## Yêu cầu
- FR-MU-84-01: tab Nhạc chọn kho để nạp: Kho kênh / Kho app (kèm số bài mỗi kho).
- FR-MU-84-02: "Nạp file…" (nhiều file) và "Nạp thư mục…" (quét đệ quy mp3/wav/flac/m4a/ogg, bỏ thư mục ẩn,
  tối đa 5000 file một lần). Tùy chọn mặc định bật: tên thư mục con (tính từ thư mục chọn) làm thẻ.
- FR-MU-84-03: host đọc thẳng file trên ổ đĩa (`AddInput.disk_files`, chỉ host đặt — tool `music.library.add`
  của agent không có trường này, schema `additionalProperties: false`); không chép vào `uploads/`; tên bài = tên
  file; trùng nội dung (hash) → dùng bài có sẵn.
- FR-MU-84-04: một job cho cả lần nạp: thanh tiến độ "Đang nạp x/y bài", nút Dừng (bài xong vẫn giữ), kết quả
  "N bài mới · M đã có sẵn · bỏ qua K file (ví dụ …)".
- Nạp/phân tích chạy trên máy (audio-analysis + CLAP), không tốn token.
