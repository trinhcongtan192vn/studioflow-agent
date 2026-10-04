# Tasks — 018

## Phase 1 — Spec, gói provider
- [x] T001 D4 4.1 `defaults`, D4 10 `license`, D13 `image_prompt`; errors.local `E_PROVIDER_UNSUPPORTED`, `E_LICENSE_NOT_ACCEPTED`; gen-contracts
- [x] T002 gói `image.qwen21-comfy` (provider.yaml + 4 workflow), `image.qwen20-api`, `image.fake`, `bg.hf-remove-background`

## Phase 2 — Test fail-trước
- [x] T010 unit `tests/unit/comfy-workflow.test.ts`: thay chỗ trống đúng kiểu, mode theo đầu vào, kích thước bội 32, alpha phẳng
- [x] T011 integration `tests/integration/comfy-server.test.ts`: ComfyUI giả lập (HTTP+WS) — khởi động, tiến độ, kết quả, hủy ≤ 5 s, khởi động lại sau 3 lỗi sức khỏe, `/free`
- [x] T012 integration `tests/integration/image-tools.test.ts`: `image.generate|edit|remove_bg` (fake) → asset + public + provenance, cache theo seed, khóa đổi theo provider, hỏi khi provider có phí, `E_ID_UNKNOWN`
- [x] T013 gpu `tests/integration/image-gpu.test.ts`: SC-001 với ComfyUI thật

## Phase 3 — Code
- [x] T020 `comfy/server.ts`, `client.ts`, `workflow.ts`
- [x] T021 `image/*` adapter + service + tools + CLI
- [x] T022 models.yaml + installer (zip strip, `{app_data}`, xác nhận giấy phép)

## Phase 4 — Nghiệm thu
- [x] T030 `npm run verify` xanh; gpu test thật
