# FN-008 — Vỏ ứng dụng, chat, bố cục và tương tác

> **Ghi chú tính năng — không ràng buộc.** Đầu vào gợi ý cho `/specify` và `/plan` của tính năng 008 (và phần giao diện của 014, 024, 028). Ràng buộc ở D10; khi tính năng được đặc tả, `specs/008-*/spec.md` thay thế file này.

## 1. Bố cục (khi đã mở kênh)

```
┌───────────────┬──────────────────────────────┬─────────────────────────────┐
│ Thanh trái    │ Khu chat                      │ Panel phải (tab)            │
│ - Kênh ▼      │ - Tiêu đề video + trạng thái  │ [Tiến độ] [Xem trước]       │
│ - Video list  │ - Luồng tin nhắn              │ [Job] [Nhạc] [Trace]        │
│ - Explorer    │ - Thẻ duyệt / thẻ xác nhận    │                             │
│   (chỉ đọc)   │ - Ô nhập + đính kèm + ngữ cảnh│ Bảng caption (dưới Xem trước│
│               │                               │  khi bật, M3)               │
├───────────────┴──────────────────────────────┴─────────────────────────────┤
│ Thanh trạng thái: GPU/engine nóng · job đang chạy · token/chi phí video · đĩa │
└──────────────────────────────────────────────────────────────────────────────┘
```
Một cửa sổ, chủ đề sáng/tối theo hệ thống, kích thước tối thiểu 1280×800.

## 2. Chat
- Tin nhắn agent: Markdown, luồng chữ. Tool call hiện dạng dòng gọn mở rộng được: tên tool tiếng Việt thân thiện + tóm tắt kết quả; job phát sinh có thanh tiến độ nhỏ, bấm để sang tab Job.
- Đính kèm: kéo thả/nút ghim; ảnh (png, jpg, webp), audio (wav, mp3, flac, m4a, ogg), văn bản (md, txt, pdf).
- Ngữ cảnh (M3): trong Xem trước, Alt+click chọn phần tử/frame hoặc nút "Đính kèm mốc hiện tại"; chip trên ô nhập.
- Lịch sử: tải từ `chat/*.jsonl`; mở lại video tiếp tục phiên `main` cũ.
- Chọn model viết: menu "Model viết: <tên>" trong tiêu đề video (đổi tầng video).

## 3. Explorer
Click file: xem trong panel (Markdown hiển thị, JSON dạng cây, ảnh/audio/video có trình phát). Chuột phải: "Mở thư mục trong Explorer của Windows", "Hỏi agent về file này".

## 4. Trạng thái và lỗi
- Lỗi hệ thống (worker chết, ComfyUI không khởi động): toast + mục trong tab Job với "Thử lại"/"Xem log".
- `core` mất kết nối: lớp phủ "Đang khởi động lại lõi…"; tự khởi động lại tối đa 3 lần.

## 5. Phím tắt
Ctrl+Enter gửi; Ctrl+K chuyển video; Ctrl+1..5 chuyển tab; Ctrl+R render nháp; Esc dừng phản hồi agent.

## 6. Khả năng truy cập
Điều hướng bàn phím toàn bộ; tương phản WCAG AA; cỡ chữ theo cài đặt Windows.
