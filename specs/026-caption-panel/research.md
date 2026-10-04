# Research — 026

## R1. Nút lỗi thời sau khi lưu
D9 mục 6 ghi "nút `captions` và `index` lỗi thời"; bảng nút D4 8.1 chỉ đưa overrides vào đầu vào của `index` (`captions` sinh `caption_groups.json` từ `audio_meta` + SCRIPT + config, không phụ thuộc override). Override được áp khi `index` dựng `compositions/captions.html` → làm theo D4 8.1: chỉ `index` lỗi thời; caption hiển thị (đầu ra caption của render) vẫn được dựng lại. Không cần sinh lại `caption_groups.json` (tốn ASR/không đổi).

## R2. Audio trong renderer
Renderer bị sandbox + CSP `default-src 'self'`. `voice.wav` 10 phút ≈ 57 MB — không gửi qua IPC. Chọn giao thức `sf-media:` đăng ký ở `main`: chỉ đọc, chỉ đường dẫn khớp `.sf/preview/*.wav`, trả Range (206) để `<audio>` biết thời lượng và tua (lần đầu dùng `net.fetch(file:)` → `duration = Infinity`). CSP thêm `media-src sf-media:`.

## R3. Đồng bộ đầu phát với Studio
FN-026 gợi ý đồng bộ qua `postMessage` nếu S6 (f) cho phép. Studio 0.8.115 không công bố API postMessage cho đầu phát → bảng chạy độc lập (FN-026 cho phép).

## R4. Tách sau gộp
Thứ tự áp cố định (tách → gộp → mốc/chữ). Tách một cụm do gộp tạo ra sẽ trỏ tới id chưa tồn tại lúc áp tách → UI không cho tách cụm gộp (bỏ gộp bằng hoàn tác). Khi tách/gộp, UI ghi mốc tường minh cho cụm kết quả (override cũ của cụm gốc: mép phải chuyển sang cụm mới, chữ sửa tay bỏ) để mốc đang thấy = mốc sau khi core áp.

## R5. Kéo mép chạm cụm kề
FN-026 cho "tự đẩy hoặc chặn" → chọn chặn (đơn giản, không đổi cụm người dùng không chạm).
