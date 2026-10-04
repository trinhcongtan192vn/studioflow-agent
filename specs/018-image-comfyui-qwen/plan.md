# Implementation Plan: Ảnh — ComfyUI + Qwen-Image-2.1

**Branch**: `018-image-comfyui-qwen` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
`packages/core/src/comfy/`: `server.ts` (`ComfyServer`: khởi động lười, cổng tự do, sức khỏe 10 s, khởi động lại sau 3 lỗi, `stop` cả cây), `client.ts` (`ComfyClient`: submit/progress/history/view/upload/interrupt/free), `workflow.ts` (nạp `workflows/<mode>.json`, thay chỗ trống theo kiểu). `packages/core/src/image/`: `qwen21-comfy.ts`, `qwen20-api.ts`, `remove-bg.ts`, `fake.ts` (adapter), `service.ts` (`generateImage`, `editImage`, `removeBackground` → `runCapability` → asset kênh `source.kind=generated` + `public/` video), `tools.ts` (`image.generate|edit|remove_bg`, job; engine `comfyui` khi provider ComfyUI), CLI `sf image`. Gói `extensions/providers/{image.qwen21-comfy,image.qwen20-api,image.fake,bg.hf-remove-background}`. `models.yaml`: `comfyui`, `qwen-image-2.1-q4` (+ `license`, xác nhận); installer: zip `strip`, `{app_data}` trong bước pip. Spec sửa: D4 4.1 (`defaults`), D4 10 (`license`), D13 (`image_prompt`), errors.local (`E_PROVIDER_UNSUPPORTED`, `E_LICENSE_NOT_ACCEPTED`).

## Technical Context
TS/Node 22 (fetch, WebSocket toàn cục) · ComfyUI v0.38.2 + ComfyUI-GGUF 6ea2651 · Python 3.12 torch 2.8.0+cu128 · Testing: unit (thay chỗ trống, làm phẳng alpha, kích thước), integration (ComfyUI giả lập HTTP+WS trong test: vòng đời, hủy ≤ 5 s, khởi động lại; `image.fake` qua tool + cache + asset), gpu (ComfyUI thật, SC-001).

## Constitution Check
- [x] I · [x] II/III · [x] IV (test trước) · [x] V (hợp đồng D4; mở rộng ghi vào docs) · [x] VI (ảnh vào kênh qua WriteStore `importFile`) · [x] VII (provenance/cache qua `runCapability`) · [x] VIII · [x] IX (ComfyUI chỉ 127.0.0.1) · [x] X (gpu test thật, CI dùng `image.fake`).

## Complexity Tracking
Không có vi phạm.
