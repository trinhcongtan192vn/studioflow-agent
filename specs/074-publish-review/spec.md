# 074 — Duyệt trước khi đăng

## Vấn đề
Video Autopilot làm xong được tải lên riêng tư rồi tự công khai sau giờ chờ phản đối (053); trạng thái đăng chỉ thấy qua Telegram, trong app không có màn nào để xem video sắp đăng, thông tin đăng, hay Đăng ngay / Hủy (Tan, 2026-10-08).

## Yêu cầu
- FR-PB-74-01 `publish.queue` ({channel}): mục `produced` có video trong 14 kế hoạch gần nhất — tiêu đề (`publish.md` → kế hoạch), giờ đăng dự kiến, nền tảng, trạng thái từng nền tảng, `stage` (`pending` còn việc / `published` / `stopped` hủy hoặc lỗi hẳn; tính theo `now` truyền vào), loại, ảnh đại diện, bản phát hành (file, thời lượng), thông tin đăng (tiêu đề, mô tả, số thẻ, số chương). Chỉ đọc.
- FR-UI-74-02 Trang "Đăng" (thanh điều hướng): nhóm Chờ đăng · Đã đăng · Đã hủy/lỗi; mỗi video: ảnh (bấm để phát bản phát hành), tiêu đề, mô tả rút gọn, thẻ/chương; mỗi nền tảng một dòng trạng thái tiếng Việt (chờ tải lên · giờ đăng / chờ phản đối đến … · công khai … / riêng tư — công khai thủ công / đã công khai / lỗi) với Xem, **Đăng ngay** (đã lên nền tảng), **Hủy đăng** (tới khi công khai). Cập nhật theo `publish.updated`.
- Sửa thông tin đăng: "Mở video" rồi nhờ agent (sửa `publish.md` từ UI sẽ làm điểm duyệt bước meta mở lại — không làm ở đây).

## AC
- `publish-queue.test.ts`: mục produced, trạng thái, bản phát hành, thông tin đăng; hết giờ phản đối → published; kênh chưa có kế hoạch → rỗng.
- `publish-format.test.ts`: chữ trạng thái (múi giờ truyền vào), nút được phép.
- UI test: trang Đăng trống.
