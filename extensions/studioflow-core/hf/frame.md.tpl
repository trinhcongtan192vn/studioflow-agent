# frame.md — design system mặc định (StudioFlow)

Kênh: {{channel_name}} · look: {{config:look.id}}

## Màu
- canvas: #101418
- surface: #1b222b
- ink (chữ chính): #f4f1ea
- muted (chữ phụ): #a7b0ba
- accent (nhấn): #e8b04a
- accent-2: #4fb3a9

## Chữ
- Họ font: `system-ui, sans-serif` (tiêu đề), `sans-serif` (thân). Không dùng tên font khác.
- Tiêu đề lớn: 120–180 px, đậm 800, chữ cách −0.02em.
- Con số/nhấn: 140–220 px, màu accent.
- Nhãn phụ: 36–48 px, màu muted.

## Bố cục
- Lưới 12 cột, lề 96 px (1920×1080); nội dung chính trong 83% trên của khung.
- Một tiêu điểm mỗi frame; khoảng trắng rộng.
- Hình vẽ bằng code: nét 4–6 px, bo góc 16 px, bóng mềm.

## Chuyển động
- Vào: fade + trượt 24–48 px, 0,5–0,8 s, ease `power3.out`; hé lộ theo nhịp lời đọc.
- Máy quay chậm toàn frame (scale 1 → 1,04) khi phù hợp.
