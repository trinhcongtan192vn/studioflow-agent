# Tasks — 011

## Phase 1 — Dữ liệu gói
- [x] T001 `extensions/studioflow-core/hf/transitions.json` (vendored), `frame-worker.md`, `frame.md.tpl`; `extensions/providers/hf.cli/version.json`; `extensions/outputs/yt-1080p30/output.json`

## Phase 2 — Test fail-trước
- [x] T010 unit `tests/unit/hf-html.test.ts`: index (thứ tự, mốc, track, audio line, caption mount), transition (kéo dài frame đi, GSAP), captions.html, kiểm file frame + `data-sf-id`
- [x] T011 unit `tests/unit/frame-packet.test.ts`: packet theo D6 mục 5 (line, timing, asset, output_path, rules)
- [x] T012 unit `tests/unit/assets.test.ts`: header PNG/JPEG/GIF/WebP/SVG, import → manifest + public, search
- [x] T013 integration `tests/integration/frame-build.test.ts`: runtime giả ghi frame qua Gateway + `step_complete(frame_id)` → index → `hyperframes lint` thật; frame thiếu `data-sf-id` → thử lại → lỗi; packet không đổi → không dựng lại; design-system
- [x] T014 integration `tests/integration/hf-adapter.test.ts`: phiên bản ghim, `lint` JSON, `data-sf-id` không đổi sau `lint` (S3 e), CLI `sf hf lint`, `sf asset`
- [x] T015 live `tests/integration/frame-live.test.ts`: Claude dựng 2 frame (record/replay) → lint + check (SC-001)

## Phase 3 — Code
- [x] T020 `hf/cli.ts`, `hf/outputs.ts`, `hf/frame-file.ts`
- [x] T021 `hf/index-html.ts` (transition), `hf/captions-html.ts`, `hf/index-builder.ts` (builder `index`, `hyperframes.json`)
- [x] T022 `hf/packet.ts`, `hf/frame-build.ts`, `hf/design-system.ts`; engine `frame_id`; `setAgentRuntime`; replay tool
- [x] T023 `assets/*`, tool `asset.import`/`asset.search`, CLI `hf`/`frame`/`asset`

## Phase 4 — Nghiệm thu
- [x] T030 `npm run verify` xanh; live record
