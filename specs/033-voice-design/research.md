# Research — 033

## R1. HyperFrames `tts` hay OmniVoice
`hyperframes tts` (0.8.115) dùng Kokoro-82M: 12 giọng có sẵn, phonemizer chỉ en-us/en-gb/es/fr/hi/it/pt-br/ja/zh. **Không có tiếng Việt và tiếng Đức**, là hai ngôn ngữ chính của app. OmniVoice (engine đang dùng) có chế độ Voice Design (`generate(instruct=…)`) và hỗ trợ 600+ ngôn ngữ, trong đó có tiếng Việt. Chọn OmniVoice (Tan chốt qua MCQ): không thêm engine, không thêm VRAM.

## R2. Giọng ổn định
Voice Design sinh giọng mới ở mỗi lần gọi, nên các line sẽ lệch giọng nhau. Cách làm: sinh **một** câu mẫu bằng `instruct` (có seed), rồi `create_voice_clone_prompt(ref_audio=câu mẫu, ref_text=câu mẫu)` → `voice.pt`. Mọi line sau đó đi theo đường clone sẵn có, nên ổn định, cache được, và `tts.synthesize` không đổi.

## R3. Từ vựng instruct
OmniVoice (`_resolve_instruct`) nhận: gender `male|female`; age `child|teenager|young adult|middle-aged|elderly`; pitch `very low pitch|low pitch|moderate pitch|high pitch|very high pitch`; style `whisper`; accent `… accent` (chỉ có tác dụng với tiếng Anh); phương ngữ tiếng Trung (không dùng). Mục lạ → ValueError. App giữ đầu vào có cấu trúc (enum ở schema tool) để agent không gõ sai, rồi tự ghép chuỗi.

## R4. Tool mới hay mở rộng `voice.profile_create`
D4 khóa `voice.profile_create {name, ref_audio, language}` là bắt buộc. Thêm một tool/capability riêng `voice.design` để không đổi hợp đồng cũ; profile vẫn ở `voices/<vo>/`, nên `voice.id`, CAST `voice_id` và `channel.validate` không đổi.

## R5. Chọn giọng
Nút **Chọn giọng này** gửi một tin chat ("Chọn giọng … (vo_…) cho …"). Agent xử lý được cả người dẫn (`config.set voice.id`) lẫn nhân vật (`voice_id` trong CAST.md) mà không cần thêm IPC ghi cấu hình từ renderer (renderer chỉ đọc, D10).
