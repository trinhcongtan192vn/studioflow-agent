# Tasks — 009

## Phase 1 — Dữ liệu mặc định
- [x] T001 Gói prompt mặc định `extensions/studioflow-core/prompts/` (pack.yaml + template + common) và rubric `script-default`, `meta-default`; mẫu kênh mới có gói prompt

## Phase 2 — Test fail-trước
- [x] T010 unit `tests/unit/prompt-pack.test.ts`: lắp prompt, biến, include, token cap → summaries → E_PROMPT_TOO_LONG, gói mặc định (US3)
- [x] T011 unit `tests/unit/text-models.test.ts`: giải model mặc định/khóa/cấu hình, E_REFINE_SAME_MODEL (US2)
- [x] T012 unit `tests/unit/objectives.test.ts`: length, read_time, beat_structure, banned_terms, tts_normalized, schema, meta_limits (US5)
- [x] T013 unit `tests/unit/refine.test.ts`: vòng/dừng/max, issues, critic sai định dạng → retry → E_REVIEW_FORMAT, ngân sách (hỏi/incomplete), ReviewRound hợp lệ (US1, US4)
- [x] T014 integration `tests/integration/text-providers.test.ts`: text.claude replay; text.openai qua máy chủ HTTP cục bộ tương thích; thiếu khóa → unavailable (US2, FR-001)
- [x] T015 integration live `tests/integration/refine-live.test.ts`: bước script với Claude thật (record) — AC-M1-02; replay chạy lại được (SC-001/002)
- [x] T016 integration `tests/integration/text-cli.test.ts` (replay)

## Phase 3 — Code
- [x] T020 `text/models.ts`, `text/providers.ts`, `text/call.ts`
- [x] T021 `text/prompts.ts`, `text/rubrics.ts`, `text/objectives.ts`
- [x] T022 `text/refine.ts`, `text/executors.ts`; engine nhận summary/refine
- [x] T023 CLI `text`, `refine`; gắn `createCore`

## Phase 4 — Nghiệm thu
- [x] T030 `npm run verify` xanh; live record
