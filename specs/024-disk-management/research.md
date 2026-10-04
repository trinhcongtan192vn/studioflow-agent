# Research — 024

## R1. Ngưỡng
- FN-024: cảnh báo < 15 GB, chặn < 5 GB; cache tới 90 % hạn mức; giữ mục của video có render phát hành trong 30 ngày; 5 render nháp/video; 10 snapshot. tech-defaults chưa có các khóa này → hằng số trong `disk/` (ghi nguồn FN-024); `CoreOptions.diskMinBytes` cho test.

## R2. Xóa qua module ghi
- Constitution VI: mọi xóa đi qua `WriteStore`. `removeDerived` nhận thêm `renders/<rd>` khi `render.json.mode` ≠ `release` và `.sf/backups/` khi gọi với `{ userRequested: true }`; artifact nguồn, `uploads/`, `music/`, `assets/` không bao giờ xóa được.

## R3. Cache ↔ video
- `cache_entries` không ghi video; liên kết qua provenance của video (`cache_key`). Mục được giữ = khóa trong `provenance/*.json` của video có `renders/*/render.json` `mode: release`, `finished_at` ≤ 30 ngày.
