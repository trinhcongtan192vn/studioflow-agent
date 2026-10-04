# Feature Specification: Kiểm hồ sơ kênh, thư viện asset dùng lại

**Feature Branch**: `022-channel-profile-validate`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 022: "`channel.validate`, thư viện asset đầy đủ dùng lại giữa video".

**Phủ yêu cầu**: FR-IM-05, AC-M2-05.

**Dựa trên `docs/`**: D6 mục 6.1 (bố cục `profile/`), 6.2 (gói prompt), 6.3 (`channel.validate`), 4.3 (rubric) · D3 mục 4 (`CastMember`), 5.13 (`AssetManifest`), 6.1 (`ChannelConfig`), 7.2 (khóa cấu hình) · D4 mục 2.4 (`asset.*`), 13 (`sf channel validate`) · D13 mục 5–6 (blueprint, gói phong cách: LUT, bộ miệng) · D10 (`channel.open`) · kiến trúc mục 14 (chống lệch hồ sơ kênh).

## User Scenarios & Testing *(mandatory)*

### US1 — `channel.validate` (P1) — AC-M2-05
`validateChannel(channel_dir) → {ok, errors[], warnings[]}`, mỗi mục `{code, path, message}`:
1. `channel_schema`: `channel.json` đúng schema (D3 6.1).
2. `config_key`: mọi `{{config:<khóa>}}` trong `profile/**/*.md` là khóa hợp lệ (D3 7.2).
3. `missing_voice`: giọng được tham chiếu (`voice.id` của kênh; `voice_id` trong `characters/*/cast.json`) không có `voices/<vo>/profile.json` + `voice.pt`.
4. `missing_style` / `missing_lut`: `look.id` của kênh không có gói phong cách (`<app-data>/extensions/styles/<id>/`, `<install>/extensions/styles/<id>/`); gói có `lut` mà file không tồn tại.
5. `missing_mouth_set`: `mouth_set` của cast không có trong gói phong cách nào (`mouths/<set>/`).
6. `blueprint_incomplete`: `profile/references/blueprints/<id>/` thiếu `blueprint.html` hoặc `blueprint.yaml`.
7. `prompt_pack`: `pack.yaml` của kênh không đọc được; bước thiếu `template`; template/include/summary không tồn tại.
8. `rubric`: rubric kênh không đọc được hoặc tổng weight ≠ 1 (±0,01).
9. Cảnh báo `missing_asset`: `STORYBOARD.md` của video tham chiếu `asset_id` không có trong thư viện kênh.

### US2 — Khi nào chạy (P1)
1. `sf channel validate <channel_dir>`: in kết quả; có lỗi → exit 1 (`E_CHANNEL_INVALID`).
2. `artifact.write` vào `channel.json` hoặc `profile/**` → kết quả ghi kèm `channel_validation` (không chặn ghi).
3. Mở kênh (IPC `channel.open`) → kèm `validation` để UI hiện.

### US3 — Thư viện asset dùng lại giữa video (P2) — FR-IM-05
1. Asset trong `assets/manifest.json` của kênh (nhập hoặc sinh, 011/018) dùng được ở mọi video: layer có `asset_id` → frame packet chép vào `public/` của video đó.
2. `asset.search` tìm trên toàn thư viện kênh (gồm asset sinh ở video khác).

### Edge Cases
- Kênh không có `profile/` → chỉ kiểm `channel.json` + tham chiếu cấu hình.
- Gói prompt của app (kênh không có gói riêng) không bị kiểm ở đây (hồi quy của app phủ).

## Requirements *(mandatory)*
- **FR-001**: `domain/channel-validate.ts` (các kiểm US1).
- **FR-002**: CLI `sf channel validate`; mã `E_CHANNEL_INVALID`.
- **FR-003**: `artifact.write` + IPC `channel.open` kèm kết quả kiểm.
- **FR-004**: D13 mục 6: trường `lut` (đường dẫn `.cube` trong gói) và thư mục `mouths/` của `style.yaml`.

## Success Criteria
- **SC-001**: AC-M2-05 — kênh có `voice.id` trỏ giọng không tồn tại và `look.id` có gói phong cách thiếu file LUT → `ok: false` với `missing_voice` và `missing_lut`; kênh mẫu đầy đủ → `ok: true`.
- **SC-002**: asset sinh ở video A được video B dùng (frame packet chép vào `public/` của B), `asset.search` từ phiên video B thấy asset đó.

## Ngoài phạm vi
Gói phong cách thật (027), sửa hồ sơ kênh qua UI, tự sửa lỗi.
