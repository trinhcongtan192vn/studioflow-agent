# Research — 029

## R1. Giá trị riêng của workflow (Tan chọn)
D6 không có chỗ khai giá trị cấu hình theo dạng video (bước `captions`/`music` không có params). Tan chọn thêm `config_defaults` vào manifest = tầng `workflow` giữa kênh và video. Lý do thứ tự: dạng video (shorts dọc, essay chậm) quyết định caption/nhịp hơn kênh; người dùng vẫn chỉnh từng video. Khóa hợp lệ ở tầng workflow: khóa cho phép ở tầng kênh hoặc video (không thêm cột vào bảng 7.2).

## R2. Khoảng lặng 600 ms
FN-029 "pause_after_ms mặc định 600": không đặt số từ/phút (giữ quy tắc thời lượng đo trên audio thật). Thêm khóa `voice.pause_after_ms` (D3 7.2) áp cho line không khai báo; essay đặt 600 qua `config_defaults`. Áp ở `loadVideoModel` (timeline, frame) và `beatDurations` (gate `audio_duration`, chương).

## R3. Blueprint `quote`, `chapter-title`, `slow-pan`, `abstract-loop`
Blueprint hiện chỉ giải từ hồ sơ kênh (`profile/references/blueprints`); gói blueprint (D13 mục 5) chưa có trong backlog M4. Essay mô tả các kiểu frame này trong skill (layer + intent) cho phiên frame dựng; khi có gói blueprint sẽ đổi sang `blueprint:`.

## R4. Chương khớp mốc beat
Trước đây chương lấy mốc trên chuỗi lời đọc; khi frame có `min_duration_ms`/giữ khung transition, timeline lệch. Nay lấy mốc tuyệt đối của line đầu beat từ `frame_timing` khi có.

## R5. Phát hiện trong lúc làm (live M2)
- Producer thật đôi khi viết tiêu đề beat sai cấp (`# … <!-- sf:beat -->`) → `stripWrapping` đưa về `##`.
- Gate `audio_duration` trượt là đường bình thường (D6 4.2): harness live giờ làm như người dùng — nhắn agent sửa beat lệch rồi chạy lại `voice`.
