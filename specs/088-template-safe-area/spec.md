# 088 — Frame mẫu nằm trong vùng an toàn; nút "Nâng cao" dễ thấy

## Bối cảnh
Video vd_rbxtpyp5 (Short) lỗi ở bước Hoàn thiện: `text_safe_area` — "NHIỀU ĐIỂM HƠN" (4,71 s) và "AI biết mình
sai" (33,61 s) chạm mép trên vùng an toàn. Frame mẫu 086 ước lượng bề rộng chữ 0,56 em/ký tự (thấp với chữ hoa
có dấu) nên chữ xuống thêm dòng, tràn hộp (căn giữa dọc) lên trên. Tan cũng không thấy khối "Nâng cao" ở tab
Tiến độ (dòng chữ mờ thu gọn).

## Yêu cầu
- FR-FB-88-01: cỡ chữ mẫu theo mô phỏng xuống dòng theo từ (bề rộng ký tự theo loại: hoa/số, thường, hẹp,
  khoảng trắng), dòng tính 1,35 em, chừa 12% bề rộng và 15% bề cao; hộp chữ lùi 24 px vào trong vùng an toàn.
  Kiểm trên bản sao vd_rbxtpyp5: 13 frame dựng lại, `text_safe_area` 0 vi phạm (mẫu cũ: đúng 2 vi phạm trên).
- FR-UI-88-02: tab Tiến độ có nút "⚙ Nâng cao: …" (tóm tắt tính năng đang bật) ở đầu tab; bấm mở/đóng bảng
  tính năng nâng cao của video. Lỗi đọc cài đặt hiện thông báo (không ẩn im lặng).
- FR-FB-88-03: khóa dựng lại của frame mẫu gồm `TEMPLATE_VERSION` (088: 2) — đổi mẫu thì chạy lại bước Dựng
  frame dựng lại frame mẫu cũ; frame do agent dựng giữ khóa cũ (không dựng lại tốn token).
