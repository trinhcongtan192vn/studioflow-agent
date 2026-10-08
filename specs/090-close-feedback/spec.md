# 090 — Bấm đóng app luôn có phản hồi rõ ràng

## Bối cảnh

Tan bấm nút đóng khi bước Hoàn thiện (render) đang chạy: không có hộp xác nhận. Nguyên nhân: kênh Nuvora bật
Autopilot và `autopilot.background` mặc định bật → nút đóng chỉ ẩn cửa sổ xuống khay (052), kể cả khi Autopilot
đang **tạm dừng**; không có thông báo nào nên trông như app đã tắt ngang.

## Yêu cầu

- FR-AP-90-01: Chỉ ẩn xuống khay khi chạy nền thực sự có ích: có kênh Autopilot, `autopilot.background` bật **và
  Autopilot không tạm dừng**. Autopilot tạm dừng → nút đóng đi qua bước kiểm việc chạy dở như thường (045): còn
  việc (bước render, job…) → hộp "Còn việc đang chạy dở"; không còn → đóng ngay.
- FR-AP-90-02: Lần đầu mỗi phiên cửa sổ bị ẩn xuống khay → bong bóng thông báo ở khay: app vẫn chạy nền, việc đang
  làm vẫn tiếp tục; mở lại bằng biểu tượng khay, thoát hẳn bằng menu chuột phải "Thoát hẳn".

## Test

- `autopilot-view.test.ts`: `closeAction` — chạy nền + tạm dừng → `check`; chạy nền + đang chạy → `hide`; thoát hẳn
  → `check`.
