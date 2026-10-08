# 066 — Xuất video ra thư mục bất kỳ

## Vấn đề
Render nằm sâu trong `<kênh>/videos/<vd>/renders/<rd>/video.mp4`; không có cách lưu video ra thư mục người dùng chọn (Tan, 2026-10-08: "Studio cần cho phép export để lưu video vào 1 folder bất kỳ"). Lựa chọn của Tan: mặc định chỉ `.mp4`, tích thêm được thumbnail, phụ đề `.srt`, mô tả `.txt`.

## Constitution
1.2 (08/10/2026) thêm ngoại lệ Điều VI: **xuất video theo yêu cầu người dùng** — chỉ **sao chép** file đã render (và file kèm) vào thư mục người dùng chọn qua hộp thoại hệ thống, nằm ngoài kênh; không bao giờ ghi đè (trùng tên → thêm ` (2)`, ` (3)`…); project chỉ được đọc.

## Yêu cầu
- FR-RD-66-01 `render.list` (VideoRef): các bản render đã xong có file — `{render_id, mode, output_profile, finished_at, duration_ms?, file}` mới nhất trước.
- FR-RD-66-02 `video.export` (VideoRef + `dest_dir`, `render_id?`, `include?: {thumbnail?, captions?, description?}`, `name?`):
  - bản render: `render_id` hoặc bản phát hành mới nhất, không có thì bản nháp mới nhất; không có bản nào → `E_FILE_NOT_FOUND`.
  - tên: `name` hoặc tiêu đề (`publish.md` → state) đã bỏ ký tự Windows cấm; bản nháp thêm ` (nháp)`.
  - file: `<tên>.mp4`; `thumbnail` → `<tên>.jpg|.png` nếu có; `captions` → `<tên>.srt` từ `caption_groups.json` + chỉnh tay; `description` → `<tên>.txt` (tiêu đề, mô tả, chương, thẻ từ `publish.md`). Mục được chọn mà không có nguồn → bỏ qua, ghi vào `skipped`.
  - không ghi đè: bất kỳ file đích nào đã có → cả bộ đổi sang ` (2)`, ` (3)`…
  - `dest_dir` phải là thư mục có sẵn, tuyệt đối, ngoài thư mục kênh → không thì `E_SCHEMA_INVALID` / `E_FILE_NOT_FOUND`.
  - kết quả `{dir, files, skipped}`.
- FR-UI-66-03 Hộp thoại "Xuất video…" (tab Xem trước, thẻ render xong trong chat): chọn bản render, tên file, 3 ô tích, thư mục (nhớ lần trước, theo máy); xong → "Mở thư mục".

## AC
- `video-export.test.ts`: chọn bản phát hành > nháp; tên sạch; kèm/không kèm từng mục; không ghi đè; từ chối thư mục trong kênh; không có render.
- UI test: mở hộp thoại xuất từ tab Xem trước.
