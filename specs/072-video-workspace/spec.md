# 072 — Khu làm video: đầu trang, tab gọn, Tệp, Studio toàn cửa sổ

## Vấn đề
Cột phải có 6 tab ngang hàng (Job/Trace/Chi phí là thông tin kỹ thuật nặng ngang Tiến độ/Xem trước); đầu trang video chỉ có tên + phase thô; tệp của video chỉ xem được qua "Chi tiết kênh"; Studio "Mở rộng" là hộp thoại 92% (Tan, 2026-10-08).

## Yêu cầu
- FR-UI-72-01 Tab: Tiến độ · Xem trước · Tệp · Nhạc · Kỹ thuật; Kỹ thuật có nhóm chọn Job · Trace · Chi phí. Ctrl+1..5 theo thứ tự tab.
- FR-UI-72-02 Đầu trang video: tiêu đề, badge Shorts/Dài, trạng thái (như thẻ 070), token/chi phí; nút "Thư mục" (mở thư mục video) và "Xuất video" (hộp thoại 066). Chưa chọn video: "Chat kênh" + gợi ý.
- FR-UI-72-03 Tab Tệp: cây thư mục của video đang mở (chỉ đọc), bấm để xem, chuột phải mở thư mục trong Windows; tải lại khi mở tab / đổi video.
- FR-UI-72-04 Studio "Toàn màn hình": phủ cả cửa sổ, thanh trên (Đính kèm mốc, Lưu thay đổi khi đang chỉnh, Thu nhỏ), Esc để thu nhỏ.

## AC
- UI test: tab Tệp có SCRIPT.md; nút Xuất video ở đầu trang; Kỹ thuật → Chi phí / Trace / Job.
