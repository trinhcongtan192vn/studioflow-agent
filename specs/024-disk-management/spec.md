# Feature Specification: Quản lý dung lượng

**Feature Branch**: `024-disk-management`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 024: "disk-management".

**Phủ yêu cầu**: FR-OP-06.

**Dựa trên `docs/`**: D4 mục 7 (cache, `cache_entries`, `budget.cache_gb`), 11 (bất biến: chỉ dọn dữ liệu dẫn xuất; `E_DISK_LOW`) · D3 mục 1 (bố cục kênh/video, `renders/`, `.sf/`), 5.14 (`RenderRecord.mode`), 7.2 (`budget.cache_gb`) · D10 UI-10 (màn Dung lượng), IPC `disk.usage` / `disk.clean` · FN-024 mục 3 (ngưỡng và chính sách giữ bản).

## User Scenarios & Testing *(mandatory)*

### US1 — Xem dung lượng (P1)
`disk.usage {channel?}` → ổ đĩa (`free_bytes`, `total_bytes`, `level: ok | warn | low`), app (`models_bytes`, `providers_bytes`), kênh: `cache_bytes`, `renders.draft_bytes`, `renders.release_bytes`, `backups_bytes`, `derived_bytes` (`.sf/` trừ sao lưu), và mỗi mục kèm số byte **sẽ giải phóng** nếu dọn.

### US2 — Dọn (P1)
`disk.clean {channel, targets: (cache | drafts | backups | snapshots)[]}` → `{freed_bytes, removed}`:
- `cache`: xóa toàn bộ `cache/objects/` của kênh + bản ghi `cache_entries` (sinh lại được).
- `drafts`: render nháp (`render.json.mode ≠ release`) ngoài 5 bản mới nhất mỗi video.
- `backups`: `.sf/backups/` của mọi video (chỉ khi người dùng chọn).
- `snapshots`: `.sf/snapshots/` ngoài 10 file mới nhất mỗi video.
- **Không bao giờ** xóa render phát hành, artifact nguồn, `uploads/`, kho nhạc, thư viện asset.

### US3 — Hạn mức cache tự động (P1)
Sau mỗi job có `channel_dir` (tối đa 1 lần/phút mỗi kênh): cache kênh > `budget.cache_gb` → xóa mục ít dùng nhất (`last_used`) tới 90 % hạn mức; giữ mục được tham chiếu bởi provenance của video có render phát hành trong 30 ngày (trừ khi không còn mục nào khác để xóa).

### US4 — Đĩa thấp (P1)
- Ổ còn < 15 GB → `level: warn` (UI cảnh báo).
- Ổ còn < 5 GB → job sinh/render (`graph.build`, `image.*`, `voice.*`, `render`) **không chạy**, kết thúc `failed` với `E_DISK_LOW` (không thử lại).

### US5 — Giao diện + CLI (P2)
- Màn Dung lượng (UI-10) trong Cài đặt: theo kênh đang mở — từng mục + nút dọn hiện số byte giải phóng; model app; cảnh báo đĩa.
- `sf disk usage [--channel]`, `sf disk clean --channel <dir> --targets cache,drafts,…`.

## Requirements *(mandatory)*
- **FR-001**: `disk/usage.ts`, `disk/clean.ts` (xóa qua `WriteStore`: chỉ đường dẫn dẫn xuất được phép).
- **FR-002**: `enforceCacheBudget` + gọi sau job.
- **FR-003**: Chặn job khi đĩa thấp (`JobKind.needsDisk`, ngưỡng `CoreOptions.diskMinBytes`, mặc định 5 GB).
- **FR-004**: IPC `disk.usage`, `disk.clean`; màn UI-10; CLI `sf disk`.

## Success Criteria
- **SC-001**: Cache vượt hạn mức → còn ≤ 90 % hạn mức, mục mới dùng và mục của video có render phát hành gần đây còn lại.
- **SC-002**: `drafts` giữ đúng 5 bản nháp mới nhất, không đụng render phát hành; `cache` dọn xong vẫn build lại được (cache miss).
- **SC-003**: Ngưỡng đĩa giả lập cao hơn dung lượng trống → `graph.build` `failed` `E_DISK_LOW`; job khác (ví dụ `download`) vẫn chạy.

## Ngoài phạm vi
Dọn bản làm việc Studio (025), di chuyển kho model sang ổ khác, gỡ model (014).
