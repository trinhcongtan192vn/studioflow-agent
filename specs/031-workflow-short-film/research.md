# Research — 031

## R1. Giọng theo cảm xúc
OmniVoice clone giọng từ một ref audio (voice prompt `.pt`). Biến thể cảm xúc = voice prompt riêng từ ref audio của cảm xúc đó (D3: `emotions` khóa → ref audio). Lưu ở `characters/<ca>/emotions/<key>.pt`, **không** trong `voices/<vo>/`: hash `voice_files` của `audio.line` là hash cả thư mục giọng — ghi thêm file vào đó làm mọi line của giọng lỗi thời ngay sau khi sinh (lặp vô hạn) và làm dự án cũ dựng lại. `emotion_ref` (hash ref audio) chỉ thêm vào hash khi line có cảm xúc được khai.

## R2. Animatic
Trước bước frames chưa có HTML → animatic dựng bằng FFmpeg từ ảnh của frame (asset của layer: `asset_id` trong storyboard hoặc ảnh nút `asset:<el>`) hoặc thẻ màu, thời lượng theo `frame_timing`, lời đọc trộn theo mốc tuyệt đối của line (không theo chuỗi lời đọc — frame không lời vẫn đúng nhịp).

## R3. ID nhân vật
Constitution/D3: ID do app gán. `artifact.write` trước đây chỉ gán cho SCRIPT/STORYBOARD → thêm `sf-cast` của `CAST.md`.

## R4. Ngoài phạm vi
- Duyệt từng ảnh biểu cảm trong UI (thẻ duyệt riêng): agent trình bày trong tóm tắt bước `cast` (duyệt cả bước).
- Khẩu hình: 032.
