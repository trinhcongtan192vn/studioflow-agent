# Research — 035

## R1. Công cụ chỉ đọc hay mở phạm vi đường dẫn
Có thể cho `artifact.read` đọc tiền tố `channel:`, nhưng như vậy mở rộng phạm vi ghi/đọc của phiên video (D5) cho mọi file kênh. Hai tool chỉ đọc, trả dữ liệu có cấu trúc (kèm `used_by`, `ready`), đủ cho việc chọn giọng mà không lộ file khác.

## R2. Dùng lại nhân vật
`loadVideoModel` đã gộp `characters/<ca>/cast.json` với CAST.md (giá trị CAST.md đè). Nên chỉ cần agent dùng lại đúng mã `ca_…`; không cần chép `voice_id`.
