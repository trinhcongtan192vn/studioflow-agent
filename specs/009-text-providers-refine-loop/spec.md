# Feature Specification: Text providers, gói prompt, `refine-loop`

**Feature Branch**: `009-text-providers-refine-loop`

**Created**: 2026-10-03

**Status**: Draft

**Input**: Backlog dòng 009: "`text.generate`/`text.review`, bố cục `profile/` + nạp gói prompt, `refine-loop`".

**Phủ yêu cầu**: FR-SC-01, FR-SC-02, FR-SC-03, FR-SC-04, FR-SC-05 (sinh `SCRIPT.md` đúng marker), FR-SC-06, AC-M1-02.

**Dựa trên `docs/`**: D6 mục 2 (bước `script`, `publish-meta`), 4 (`refine-loop`, kiểm khách quan, rubric), 6.1–6.2 (bố cục `profile/`, gói prompt) · D4 mục 3 (`TextGenerateInput/Output`, `TextReviewInput/Output`), 4.3 (provider `text.claude`, `text.openai`, `text.deepseek`; mặc định `text.producer/critic/aux`), 4.4 · D3 mục 5.4 (`SCRIPT.md`), 5.11 (`ReviewRound`), 5.12 (provenance), 5.15 (`publish.md`), 7.2 (`text.*`, `refine.*`, `script.wpm.<lang>`, `check.*`, `meta.*`, `budget.*`) · D5 mục 2 (phiên `critic`), 5.1 (hỏi khi API có phí), 5.4 (khóa bí mật) · D11 (span `sf.text.call`) · D12 mục 2 (ghi/phát lại LLM).

## Bối cảnh & mục tiêu
Kịch bản và tiêu đề/mô tả do model người dùng chọn viết theo gói prompt của kênh, rồi qua `refine-loop`: critic khác model chấm theo rubric, producer sửa, 2–3 vòng; người dùng chỉ duyệt bản cuối với tóm tắt các vòng. Khi chưa có khóa API ngoài, producer và critic đều là Claude (gói Claude của người dùng) nhưng khác tầng model.

## User Scenarios & Testing *(mandatory)*

### US1 — Viết kịch bản qua refine-loop (P1) — FR-SC-01..03, AC-M1-02
1. **Given** video đã duyệt brief, workflow có bước `script` với `refine.enabled`, **When** engine chạy bước, **Then** producer viết nháp theo gói prompt, critic (model khác) chấm ≥ 2 vòng (tối đa 3), mỗi vòng ghi `reviews/script/round-<n>.json` hợp lệ; `SCRIPT.md` cuối có beat/line với ID; bước `waiting_approval` kèm tóm tắt điểm các vòng và vấn đề đã sửa/còn lại; `state.json.steps.script.refine = {rounds, final_score, incomplete?}`.
2. Dừng sớm nhất ở vòng ≥ `min` khi điểm ≥ `threshold`, không còn vấn đề `critical`/`major` và mọi kiểm khách quan qua.
3. `changes_requested` với ghi chú → refine chạy lại với ghi chú là vấn đề bổ sung.

### US2 — Producer/critic theo cấu hình (P1) — FR-SC-01, FR-SC-06
1. `text.producer`, `text.critic`, `text.aux` (dạng `<provider>/<model>`) đặt được theo kênh hoặc video; không đặt → mặc định D4 mục 4.3 (`openai/…` nếu có khóa OpenAI, ngược lại `claude/claude-sonnet-5-5`; critic `claude/claude-opus-5-5`; aux `claude/claude-haiku-4-5`).
2. Producer và critic trùng `provider + model` → `E_REFINE_SAME_MODEL` trước khi gọi LLM; cả hai là Claude → tóm tắt ghi "critic cùng hãng".
3. Provider không khả dụng (thiếu khóa) → `E_PROVIDER_UNAVAILABLE` gợi ý thêm khóa.

### US3 — Gói prompt kênh (P1) — D6 mục 6.2
1. Lắp prompt = template của bước + `include` theo thứ tự; biến `{{brief}}`, `{{target_words}}`, `{{language}}`, `{{rubric_short}}`, `{{issues}}`, `{{draft}}`, `{{config:<khóa>}}` được thay.
2. Vượt `token_cap` → thay file có bản tóm tắt (`summaries`); vẫn vượt → `E_PROMPT_TOO_LONG`.
3. Kênh chưa có gói prompt → dùng gói mặc định của app; kênh mới khởi tạo có sẵn gói mặc định trong `profile/references/prompts/`.

### US4 — Ngân sách (P2) — FR-SC-04
1. Dự trữ ≈ chi phí ước tính × `min` vòng; ngân sách còn lại (theo `budget.api_cost_usd_per_video`, `budget.tokens_per_video`) không đủ → hỏi người dùng (đồng ý = chạy, từ chối = hủy bước).
2. Cạn giữa chừng → dừng vòng, `refine.incomplete = true`, tóm tắt ghi "chưa đủ vòng"; người dùng chọn ở thẻ duyệt (duyệt = chấp nhận, yêu cầu sửa = chạy thêm).
3. Token và chi phí mỗi lần gọi cộng vào `state.json.budget`.

### US5 — Kiểm khách quan (P1) — D6 mục 4.2
`length`, `read_time`, `beat_structure`, `banned_terms`, `tts_normalized`, `schema` (script) và `meta_limits` (meta) chạy trong refine và dùng được làm gate `objective`.

### US6 — `publish-meta` (P2)
Bước `publish-meta` sinh `publish.md` (tiêu đề, mô tả, thẻ, chương theo beat) qua refine với rubric `meta-default`; qua `meta_limits`.

### Edge Cases
- Critic trả không đúng JSON → thử lại 1 lần → `E_REVIEW_FORMAT`.
- Producer trả kịch bản không parse được → coi như vấn đề `critical` của vòng đó (kiểm `schema` không qua), vòng sau sửa; vòng cuối vẫn hỏng → bước `failed`.
- `refine.enabled: false` → một lần sinh, không critic.

## Requirements *(mandatory)*
- **FR-001**: Provider `text.claude` (Agent SDK, không tool, một lượt) cho `text.generate` và `text.review`; `text.openai`, `text.deepseek` (API tương thích OpenAI, khóa qua kho bí mật) cho `text.generate`/`text.review`.
- **FR-002**: Chọn model theo `text.producer/critic/aux` + mặc định động D4 mục 4.3.
- **FR-003**: Mọi lời gọi LLM qua lớp ghi/phát lại `SF_LLM` (D12) và cộng usage/chi phí vào ngân sách video.
- **FR-004**: Nạp gói prompt (`pack.yaml`, template, include, summaries, token cap, biến); gói mặc định của app; kênh mới có gói.
- **FR-005**: Nạp rubric (gói workflow `rubrics/`, ghi đè kênh `profile/references/rubrics/`, mặc định của app), kiểm Σweight = 1 ± 0,01.
- **FR-006**: Kiểm khách quan D6 mục 4.2 (đăng ký vào gate `objective`).
- **FR-007**: `refine-loop` D6 mục 4.1: dự trữ ngân sách, vòng, dừng, `ReviewRound`, kiểm khác model, tóm tắt cho approval, `step.refine`.
- **FR-008**: Executor bước `script` (`narration`, `outline` → `STORY.md`, `screenplay`) và `publish-meta`; provenance cho file sinh ra.
- **FR-009**: Engine nhận `summary`/`refine` từ executor để gắn vào approval/`state.json`.
- **FR-010**: CLI `sf text ask --channel <dir> [--role primary|aux] <prompt>`, `sf refine run --channel <dir> --video <vd> --step <id>`.

## Success Criteria *(mandatory)*
- **SC-001**: AC-M1-02 với Claude thật (record): ≥ 2 vòng, critic khác model, tóm tắt hiển thị điểm các vòng.
- **SC-002**: Toàn bộ test chạy `SF_LLM=replay` không mạng.
- **SC-003**: Độ phủ dòng core ≥ 80%.

## Phạm vi
**Trong**: provider text, chọn model, gói prompt, rubric, kiểm khách quan, refine-loop, executor `script` + `publish-meta`, CLI.
**Ngoài**: refine cho storyboard (M2, FR-SC-07), UI thẻ duyệt (008), kho bí mật Windows (014 — ở 009 khóa đọc từ biến môi trường `OPENAI_API_KEY`/`DEEPSEEK_API_KEY` qua hàm `getSecret`), báo cáo chi phí (028).

## Assumptions
- Mặc định model `[chờ S14]`: producer `claude-sonnet-5-5`, critic `claude-opus-5-5`, aux `claude-haiku-4-5` (Claude khác tầng khi không có khóa ngoài).
- Ước lượng token = số ký tự / 3 (đủ cho kiểm `token_cap`; không cần tokenizer chính xác).
- Model OpenAI/DeepSeek mặc định khi có khóa: `openai/gpt-5`, `deepseek/deepseek-chat` (ghi đè bằng cấu hình).
