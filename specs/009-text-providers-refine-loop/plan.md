# Implementation Plan: Text providers, prompt pack, refine-loop

**Branch**: `009-text-providers-refine-loop` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

## Summary
`packages/core/src/text/`: `providers.ts` (`text.claude` qua Agent SDK một lượt không tool; `text.openai`/`text.deepseek` qua `fetch` API Chat Completions), `models.ts` (giải `text.producer/critic/aux`), `call.ts` (gọi qua ghi/phát lại + cộng ngân sách), `prompts.ts` (gói prompt), `rubrics.ts`, `objectives.ts` (kiểm D6 4.2, đăng ký gate), `refine.ts` (thuật toán D6 4.1), `executors.ts` (`script`, `publish-meta`); gói mặc định `extensions/studioflow-core/{prompts,rubrics}`; mẫu kênh mới có gói prompt; engine nhận `summary`/`refine` từ executor; CLI `text`, `refine`.

## Technical Context
TS/Node 22 · Agent SDK (005) · không thêm phụ thuộc (OpenAI qua `fetch`) · Storage: `reviews/<step>/round-<n>.json`, `SCRIPT.md`, `STORY.md`, `publish.md`, `provenance/`, `state.json.budget` · Testing: unit (prompt pack, objectives, refine với hàm producer/critic giả), integration replay (bản ghi `tests/fixtures/llm/text/`), live record (AC-M1-02).

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (`TextGenerateInput/Output`, `TextReviewInput/Output`, `Rubric`, `ReviewRound`, `Provenance` từ `docs/contracts`) · [x] VI (mọi ghi qua module ghi) · [x] VII (provenance cho file sinh; log mỗi lời gọi text kèm token/chi phí; span ở 015) · [x] VIII · [x] IX (provider adapter là ranh giới đã định) · [x] X (LLM chỉ giả lập bằng ghi/phát lại).

## Complexity Tracking
Không có vi phạm.
