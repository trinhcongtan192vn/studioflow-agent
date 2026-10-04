# Feature Specification: Ảnh — ComfyUI + Qwen-Image-2.1, provider 2.0 API, tách nền

**Feature Branch**: `018-image-comfyui-qwen`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 018: "vòng đời ComfyUI, Qwen-Image-2.1, provider 2.0 API".

**Phủ yêu cầu**: FR-IM-02, FR-IM-03, FR-IM-04, FR-OP-05.

**Dựa trên `docs/`**: D4 mục 2.4 (`image.generate`, `image.edit`, `image.remove_bg`), 3 (`ImageGenerateInput`, `ImageEditInput`, `ImageOutput`, `RemoveBgInput`), 4.1–4.4 (manifest, adapter, provider mặc định, định tuyến), 5 (job: hủy ≤ 5 s), 6 (engine `comfyui` độc chiếm GPU, `release`), 7 (cache), 9.2 (ComfyUI provider, hợp đồng workflow JSON), 10 (models.yaml, hồ sơ `full`) · D3 mục 5.12 (provenance), 5.13 (`AssetManifest`), 7.2 (`provider.*`, `policy.batch.images`) · D12 (`image.fake` khi `SF_GPU=0`) · FN-014/018/024 mục 2 · Spike S2/S2c (chạy trong tính năng này, ghi ở `research.md`).

## User Scenarios & Testing *(mandatory)*

### US1 — Sinh ảnh (P1) — FR-IM-02
1. Agent gọi `image.generate {prompt, negative_prompt?, width, height, transparent?, reference_asset_ids?, look?, seed?, steps?}` → job → `{asset_id}`; ảnh nằm ở `assets/files/<as>.png` của kênh, đăng ký `assets/manifest.json` (`source.kind = generated`), có provenance; khi phiên gắn video → chép `public/<as>.png` của video.
2. Cùng đầu vào + seed → trúng cache (không gọi ComfyUI), provenance `from_cache: true`. Không có seed → app chọn seed và ghi lại (tái lập được).
3. `look` (id style pack) → thêm `image_prompt` của style vào prompt; không có trường đó → bỏ qua kèm ghi chú.
4. Kích thước làm tròn bội 32 (Qwen-Image-2.1); ngoài 256–2048 → `E_SCHEMA_INVALID`.

### US2 — Sửa ảnh và ảnh trong suốt (P1) — FR-IM-03
1. `image.edit {source_asset_id, instruction, mask_asset_id?, reference_asset_ids?, seed?}` → asset mới (ảnh nguồn giữ nguyên).
2. `transparent: true` → chế độ `t2i_rgba` → PNG có alpha (`alpha: true` trong manifest).
3. `image.remove_bg {source_asset_id, subject}` → asset mới PNG trong suốt (provider `bg.hf-remove-background`, CPU).

### US3 — Vòng đời ComfyUI (P1) — FR-OP-05
1. App khởi động ComfyUI headless đã cài (`<app-data>/providers/comfyui/`, Python engine `<app-data>/providers/python/comfyui/`) khi job ảnh đầu tiên cần, cổng ngẫu nhiên trên `127.0.0.1`, thư mục input/output/temp/user riêng của app.
2. Sức khỏe `GET /system_stats` mỗi 10 s; 3 lần lỗi liên tiếp → khởi động lại; core đóng → dừng tiến trình (cả cây).
3. Hủy job → `POST /interrupt` + xóa khỏi hàng đợi ComfyUI, job dừng ≤ 5 s. `release()` → `POST /free {unload_models, free_memory}`. Tiến độ qua WebSocket `/ws?clientId=`.
4. Chưa cài → `health` không ok → `E_PROVIDER_UNAVAILABLE` gợi ý cài hồ sơ `full`.

### US4 — Provider Qwen-Image-2.0 API (P2) — FR-IM-04
1. Người dùng đặt `provider.image.generate = image.qwen20-api` (và/hoặc `image.edit`) + khóa bí mật `dashscope_api_key` (Credential Manager) + endpoint workspace trong `settings.json` → ảnh sinh qua API Alibaba Cloud Model Studio, tải về ngay (URL hết hạn 24 h).
2. Mỗi lần gọi có phí → hỏi người dùng trước (D5 5.1, `policy.auto_approve.paid_api`); `transparent` không hỗ trợ → `E_PROVIDER_UNSUPPORTED`.
3. Đổi provider → khóa cache khác → ảnh liên quan lỗi thời (nền cho AC-M2-03 ở 020).

### US5 — Cài đặt (P2)
1. `models.yaml`: `comfyui` (mã ComfyUI ghim + custom node ComfyUI-GGUF ghim + môi trường Python), `qwen-image-2.1-q4` (3 file model, sha256) — hồ sơ `full`.
2. Model có giấy phép không thương mại (`Qwen Research`) → cài phải có xác nhận giấy phép của người dùng (`--accept-license` ở CLI, hộp xác nhận ở onboarding); xác nhận ghi trong `settings.json.installed`.

### Edge Cases
- ComfyUI trả lỗi node (`/prompt` 400 hoặc `execution_error`) → `E_PROVIDER_FAILED` kèm thông điệp node.
- ComfyUI chết giữa job → job lỗi retryable; lần sau khởi động lại.
- Asset nguồn không tồn tại → `E_ID_UNKNOWN`.

## Requirements *(mandatory)*
- **FR-001**: `comfy/server.ts` — vòng đời ComfyUI (khởi động lười, cổng ngẫu nhiên, sức khỏe 10 s, khởi động lại sau 3 lỗi, dừng cả cây tiến trình).
- **FR-002**: `comfy/client.ts` — `/prompt`, `/ws` tiến độ, `/history`, `/view`, `/upload/image`, `/interrupt`, `/queue` (xóa), `/free`.
- **FR-003**: Gói provider `extensions/providers/image.qwen21-comfy/` (`provider.yaml` có `defaults`; `workflows/{t2i,t2i_rgba,edit_ref,edit_mask}.json` dạng API với chỗ thay thế D4 9.2) + adapter.
- **FR-004**: `image.fake` (CI), `bg.hf-remove-background` (`hyperframes remove-background`), `image.qwen20-api` (cloud, khóa bí mật, hỏi khi có phí).
- **FR-005**: Tool `image.generate`, `image.edit`, `image.remove_bg` (job, engine `comfyui` cho provider ComfyUI) → asset kênh + `public/` video; cache + provenance qua `runCapability`.
- **FR-006**: `models.yaml` mục `comfyui`, `qwen-image-2.1-q4` (+ trường `license`); installer: `git_archive`/`extract` cho mã, xác nhận giấy phép; dev cài bằng cùng installer: `npm run sf -- model install comfyui`, `comfyui-env`, `qwen-image-2.1-q4 --accept-license`.
- **FR-007**: D4 sửa: `ProviderManifest.defaults` (đã nêu ở 9.2 nhưng thiếu trong interface), `models.yaml` trường `license`; D13 `style.yaml` trường `image_prompt`.
- **FR-008**: CLI `sf image generate|edit|remove-bg`.

## Success Criteria
- **SC-001** (gpu): ảnh 1664×928 sinh thật ≤ 60 s sau khi nạp model; RGBA có alpha (≥ 30% pixel trong suốt với prompt vật thể đơn); edit giữ kích thước nguồn; `/free` đưa VRAM về ≤ mức trước + 0,5 GB.
- **SC-002**: hủy job ảnh đang chạy → `canceled` ≤ 5 s (test với ComfyUI giả lập HTTP/WS).
- **SC-003**: cùng đầu vào + seed → lần 2 trúng cache; đổi provider → khóa khác.

## Ngoài phạm vi
Lịch GPU theo pha và ngân sách VRAM giữa engine (019), nút `asset` trong build graph và đánh dấu lỗi thời theo provider (020), bước `assets` của workflow (023), NVFP4 (S2b), màn cài đặt mới (dùng onboarding 014).
