# 086 — Frame dựng từ mẫu (mặc định) và tạm dừng khi hết lượt Claude

## Bối cảnh
Short 45 giây của Tan (vd_rbxtpyp5): 13 frame → 26 phiên agent `frame` (mỗi frame một lần Haiku + một lần
Sonnet), chạm giới hạn phiên Claude ngay ở bước Dựng frame; sau khi chạm giới hạn app vẫn mở tiếp các phiên còn
lại (lỗi ngay). Dựng frame là chỗ tốn token nhất của một video.

## Yêu cầu
- FR-FB-86-01: khóa `advanced.custom_frames` (boolean, app/channel/video, mặc định `false`). Tắt → bước
  `frame-build` dựng mọi frame bằng **mẫu** (HTML tất định từ frame packet + `frame.md`, không phiên agent, 0
  token). Bật → như cũ (mỗi frame một phiên `frame`).
- FR-FB-86-02: mẫu theo từ đầu của `intent` (`big-text`, `stat-pop`, `split-reveal`, `image-focus`, `list`);
  không có → chọn theo layer (ảnh có asset → `image-focus`; ≥ 3 chữ → `list`; 2 chữ hoặc "A ≠ B" →
  `split-reveal`; chữ ngắn có số → `stat-pop`; còn lại `big-text`). Màu/font từ `frame.md`; chữ trong vùng an
  toàn, tránh dải caption; cỡ chữ vừa hộp. Mỗi layer đúng một `data-sf-id`; layer không có mẫu riêng (shape,
  chart, overlay, ảnh thiếu file) → phần tử nhấn tối giản (sửa được trong Studio). Theo hợp đồng frame worker
  (một `<template>`, nền clip riêng, một timeline dừng, không hiệu ứng thoát, không animate visibility clip).
- FR-FB-86-03: frame mẫu bị `hyperframes lint/check` báo lỗi → khi `advanced.custom_frames` tắt, bước báo lỗi
  kèm phát hiện (không tự gọi agent); bật → gửi phiên frame sửa như cũ.
- FR-WF-86-04: lỗi hết lượt Claude (`E_RUNTIME_RATE_LIMIT`) trong bước dựng frame → dừng mở phiên mới ngay,
  không thử lại bằng model khác. Mọi bước lỗi vì hết lượt (video không thuộc Autopilot — Autopilot có cơ chế
  riêng 052) → engine tự chạy lại bước đó lúc hết hạn mức (+1 phút; không đọc được giờ → sau 1 giờ); thông báo
  lỗi ghi giờ tự chạy lại. Mở lại app sau giờ đó → chạy lại ngay khi mở video.
- FR-UI-86-05: khối "Nâng cao" thêm "Frame tùy biến bằng AI".
