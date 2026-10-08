# 082 — Màn Kênh và Cài đặt kênh; ngôn ngữ mặc định theo kênh

## Vấn đề
Tan (2026-10-08, ảnh màn "Kênh đang quản lý"): danh sách kênh dạng chữ rời rạc (nút Autopilot / Cài đặt kênh / Bỏ nằm lẫn), ô tạm dừng Autopilot lọt thỏm, form tạo kênh trống trải; Cài đặt kênh một khối dài; chưa có cài đặt ngôn ngữ mặc định cho kênh (`channel.json.language` có sẵn nhưng không sửa được, tạo kênh luôn `vi`).

## Yêu cầu
- FR-WS-82-01 IPC `channel.info.get` (`id, name, language, created_at, path, videos`) và `channel.info.set {name?, language?}` (tên 1–100 ký tự, ngôn ngữ `vi`/`en`/`de`, sai → `E_SCHEMA_INVALID`); `channels.managed` thêm `language`. Video tạo sau dùng ngôn ngữ mới; video đã có giữ nguyên.
- FR-UI-82-02 Màn Kênh: đầu trang (Tạo kênh mới · Thêm thư mục kênh có sẵn · Đóng); form tạo kênh có tên + ngôn ngữ; khối Autopilot toàn cục (đang chạy / tạm dừng, giải thích); lưới thẻ kênh: chữ cái đầu, tên, thư mục, badge chế độ / ngôn ngữ / số đối thủ / đang mở / thiếu thư mục, nút Mở kênh, Cài đặt, công tắc Autopilot, bỏ khỏi danh sách (hỏi xác nhận, không xóa thư mục).
- FR-UI-82-03 Cài đặt kênh: mục lục (Thông tin kênh · Chế độ · Nội dung · Kênh đối thủ · Đăng video); Thông tin kênh: tên, ngôn ngữ mặc định, thư mục (mở được), số video; chế độ dạng hai thẻ chọn; nguồn giá trị dạng nhãn nhỏ; chip workflow/nền tảng nổi bật khi chọn; đối thủ dạng thẻ có ảnh.

## AC
- `host.test.ts`: đọc/đổi tên + ngôn ngữ, `channels.managed.language`, video mới `language: en`, giá trị sai bị từ chối.
- UI test: ô ngôn ngữ trong Cài đặt kênh = `vi`; các `data-testid` cũ vẫn dùng được.
