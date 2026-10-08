# 089 — Video render phát hết trong app (không dừng sau 2 giây)

## Bối cảnh
Tan bấm "Xem video" (thông báo Hoàn thiện xong trong chat) cho vd_rbxtpyp5: video tự dừng sau ~2 giây, nút Play
hiện lại. File render đủ 46,5 s (ffprobe, khung hình và âm thanh đều đúng). Tái hiện trong Electron: khung xem
tệp tải trước siêu dữ liệu (`preload` mặc định), Chromium ngắt yêu cầu Range đầu rồi nối lại từ byte N; với
scheme `sf-media:` khai báo không chuẩn, lần nối lại báo `PIPELINE_ERROR_READ: FFmpegDemuxer: data source error`.

## Yêu cầu
- FR-UI-89-01: `sf-media` là scheme chuẩn (`standard`, `secure`, `stream`, `supportFetchAPI`); URL
  `sf-media://f/<đường dẫn tuyệt đối, mã hóa từng đoạn>`; một hàm `mediaUrl` dùng chung ở renderer.
- FR-UI-89-02: yêu cầu Range mở (`bytes=N-`) trả tối đa 2 MiB mỗi lần, đọc sẵn vào bộ nhớ; Range hậu tố và Range
  ngoài file (416) xử lý đúng. Danh sách file được phép (render, ảnh, audio xem trước) giữ nguyên.
- Test UI: render 20 s (> 4 MB) mở trong khung xem tệp, chờ tải trước rồi phát → sau 7 s vẫn chạy (> 5 s), không
  lỗi. Trên code cũ test này trượt.
