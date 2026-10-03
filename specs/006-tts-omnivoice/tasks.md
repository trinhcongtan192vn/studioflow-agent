# Tasks — 006

## Phase 1 — Hạ tầng
- [ ] T001 Môi trường engine `omnivoice` (torch cu128 + omnivoice 0.2.1) + `scripts/setup-engine.mjs` (FR-010)
- [ ] T002 Manifest `extensions/providers/{tts.omnivoice,tts.fake}/provider.yaml` (FR-003, FR-004)

## Phase 2 — Test fail-trước
- [ ] T010 Python contract `tests/contract/test_rpc.py`: serve fake engine — health/load/run/progress/cancel/offload/unload, lỗi JSON-RPC (US4)
- [ ] T011 Python unit `tests/unit/test_audio.py`: wav 48 kHz mono 16-bit, resample, độ dài ref (FR-005, US2 AC2)
- [ ] T012 Python gpu `tests/gpu/test_omnivoice.py`: clone + sinh câu vi, đo RTF/VRAM (SC-001/002)
- [ ] T013 Node integration `tests/integration/worker-client.test.ts`: client ↔ worker fake thật; worker chết → E_PROVIDER_FAILED rồi tự khởi động lại; dừng khi đóng (FR-002)
- [ ] T014 Node integration `tests/integration/tts.test.ts`: `tts.fake`, builder audio.line + audio_meta, sửa 1 line → 1 lần gọi, cast voice, thiếu giọng; tool `tts.synthesize`/`voice.preview`/`voice.profile_create` (US1–3, US5)
- [ ] T015 Node integration `tests/integration/tts-cli.test.ts`: `sf video create`, `sf tts say` (cache lần 2), `sf voice create` (US6)
- [ ] T016 Node gpu `tests/gpu/omnivoice.gpu.test.ts`: provider thật qua worker (clone + say + cache) (SC-001)
- [ ] T017 live+gpu `tests/integration/m0-acceptance.test.ts`: AC-M0-01/02 qua chat (Claude thật + OmniVoice thật)

## Phase 3 — Code
- [ ] T020 `sf_worker` rpc + engines + audio
- [ ] T021 `workers/client.ts`
- [ ] T022 providers (omnivoice, fake, manifest loader, đăng ký mặc định) + routing fake khi `SF_GPU=0`
- [ ] T023 `tts/builder.ts`, `tts/tools.ts`; gắn vào `createCore`
- [ ] T024 CLI `video`, `tts`, `voice`

## Phase 4 — Nghiệm thu
- [ ] T030 `npm run verify` xanh; `gpu` + live trên máy tham chiếu; ghi số liệu S1 vào research
