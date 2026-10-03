# Research — 017 (một phần S6)

## R1. Bản chụp thay cho chèn script chặn lưu
- **Quan sát (hyperframes 0.8.115)**: `hyperframes preview` **tự ghi lại `index.html`** của dự án khi mở (chuẩn hóa HTML: `<!doctype html>` → `<!DOCTYPE html>`). Chạy trực tiếp trên thư mục video (D9 mục 2 gợi ý) sẽ làm đổi hash file cảnh → điểm duyệt mất hiệu lực, nút `index` stale.
- **Decision**: Studio chạy trên `.sf/studio-preview/<vd>/` (dẫn xuất): file cảnh + `compositions/` chép qua module ghi, `public/`/`audio/` là junction (không tốn chỗ; `rmSync` xóa junction không xóa đích — đã kiểm). Theo dõi file cảnh của video → đồng bộ lại (debounce 300 ms) → Studio tự tải lại. Không cần chèn script chặn lưu `[chờ S6]` cho chế độ xem; `data-sf-*` vẫn có trong bản Studio ghi lại.
- URL Studio: `http://127.0.0.1:<port>/#project/<tên thư mục>`; khởi động ~2 s; dừng bằng kill cây tiến trình.
