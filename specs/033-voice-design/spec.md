# Feature Specification: Giọng gợi ý từ mô tả (voice design)

**Feature Branch**: `033-voice-design`

**Created**: 2026-10-05

**Status**: Draft

**Input**: Yêu cầu của Tan (2026-10-05): "dùng phần voice để tạo giọng đọc gợi ý (như 1 option nhanh) khi chưa có file giọng mẫu… hỗ trợ cả kịch bản dạng story (nhiều giọng cho nhiều nhân vật)". Quyết định (MCQ): engine **OmniVoice Voice Design**; luồng **gợi ý 2–3 giọng để nghe thử và chọn**.

**Phủ yêu cầu**: FR-VO-06 (mới, PRD), bổ sung FR-VO-01 và FR-VO-05.

**Dựa trên `docs/`**: D4 mục 2.4 (tool `voice.*`), mục 3 (hợp đồng capability), mục 4.3 (provider mặc định); D3 mục 2 (`voices/<voice_id>/`); D5 mục 6 (policy capability `voice.*`); FN-031 mục 3 (giọng nhân vật).

## User Scenarios & Testing *(mandatory)*

### US1 — Kênh chưa có file giọng mẫu (P1)
Bước Giọng đọc báo thiếu giọng. Trên thẻ lỗi, người dùng bấm **✨ Gợi ý giọng**. Agent đọc hồ sơ kênh và BRIEF, rồi tạo 2–3 giọng khác nhau (`voice.design`). Mỗi giọng hiện trong chat thành một thẻ có tên, mô tả (giới tính, tuổi, cao độ), trình nghe câu mẫu và nút **Chọn giọng này**. Người dùng chọn một giọng; agent đặt `voice.id` rồi chạy lại bước.

### US2 — Phim nhiều nhân vật (P1)
Ở bước `cast` (short-film), người dùng không có file mẫu cho một hoặc nhiều nhân vật. Agent tạo 2 giọng gợi ý cho mỗi người nói, dựa trên tuổi, giới tính và tính cách trong STORY/CAST. Mỗi thẻ ghi rõ giọng dành cho ai. Người dùng chọn từng giọng; agent ghi `voice_id` vào CAST.md.

### US3 — Giọng ổn định cho cả video (P1)
Giọng gợi ý được "đóng băng": app sinh một câu mẫu bằng mô tả, rồi clone câu mẫu đó thành `voices/<vo>/voice.pt`. Từ đó mọi line dùng cùng một giọng, như giọng clone từ file thật. Cùng mô tả mà khác `seed` thì cho giọng khác, để có nhiều phương án.

## Requirements *(mandatory)*

- **FR-001** Capability `voice.design` (hợp đồng v1).
  - Đầu vào: `{name, language, instruct, sample_text, seed?}`.
  - Đầu ra: `{voice, ref, ref_text}` từ provider; app ghi `voices/<vo>/{voice.pt, ref.wav, profile.json}`.
  - `profile.json` có `design: {instruct, seed}` và `suggested_for?`.
  - Provider `tts.omnivoice` (task worker `voice.design`) và `tts.fake` (CI).
  - Cache theo `instruct + sample_text + language + seed`.
- **FR-002** Tool Gateway `voice.design`, chỉ phiên `main`, trả về job.
  - Đầu vào có cấu trúc: `gender (male|female)`, `age (child|teenager|young adult|middle-aged|elderly)`, `pitch (very low|low|moderate|high|very high)`, `whisper?`, `accent?` (chỉ khi ngôn ngữ là en), `name`, `for?` (`narrator` hoặc `ca_…`), `sample_text?`, `seed?`.
  - App ghép các trường thành `instruct` theo từ vựng OmniVoice.
  - Khi không có `sample_text`, dùng câu mẫu mặc định theo ngôn ngữ kênh, đọc khoảng 6–9 giây.
  - Kết quả job: `{voice_id, name, for?, preview: voices/<vo>/ref.wav, design}`.
- **FR-003** Chat: job `voice.design` thành công → thẻ giọng gợi ý (tên, chip mô tả, audio nghe thử qua `sf-media`, nút **Chọn giọng này** gửi lời chọn cho agent). Thẻ lỗi thiếu giọng có thêm CTA **✨ Gợi ý giọng**.
- **FR-004** `sf-media` cho đọc `voices/<vo>/ref.wav` (chỉ đọc).
- **FR-005** Skill: thiếu file mẫu → gợi ý 2–3 giọng khác nhau cho mỗi người nói thiếu giọng; không tự chọn thay người dùng; chọn xong → `config.set voice.id` (người dẫn) hoặc `voice_id` trong CAST.md (nhân vật).

## Success Criteria *(mandatory)*

- **SC-001** Integration (fake): `voice.design` → job thành công → có `voice.pt`, `ref.wav`, `profile.json` (`design.instruct` = "female, young adult, moderate pitch"); giọng dùng được cho bước `voice` (TTS sinh line).
- **SC-002** Unit: ghép instruct đúng từ vựng; `accent` với ngôn ngữ khác en → `E_SCHEMA_INVALID`; khác `seed` → khác voice_id và khác cache.
- **SC-003** Desktop unit: thẻ giọng từ `JobInfo` (`voiceSuggestion`); CTA "✨ Gợi ý giọng" xuất hiện ở lỗi thiếu giọng.
- **SC-004** GPU (máy tham chiếu): OmniVoice thiết kế giọng tiếng Việt → câu mẫu 3–10 s → clone → TTS line.
