# docs/contracts — hợp đồng máy kiểm được

Sinh bằng `node scripts/gen-contracts.mjs` (tính năng 002). `npm run verify` chạy `--check` và báo đỏ nếu file đã commit lệch nguồn.

| File | Nguồn | Sửa thế nào |
|---|---|---|
| `domain/d3.ts` | khối TypeScript trong `docs/03-spec-domain-artifacts.md` mục 3–7 | sửa D3 rồi chạy generator |
| `domain/config-keys.ts`, `domain/config-keys.json` | bảng D3 mục 7.2 | sửa bảng D3 rồi chạy generator |
| `domain/markdown.ts` | **viết tay** theo ví dụ D3 5.2–5.6, 5.15 (D3 chưa có khối TS cho front matter) | sửa trực tiếp, giữ khớp D3 |
| `domain/schemas/*.schema.json` | sinh từ type ở trên (`ts-json-schema-generator`), thêm pattern ID D3 mục 2 | không sửa tay |
| `errors.json` | mọi bảng "Mã lỗi" trong `docs/03`–`docs/11` + `errors.local.json` | sửa bảng trong tài liệu, hoặc `errors.local.json` cho mã riêng của tính năng |
| `errors.local.json` | **viết tay**: mã không thuộc bảng D3–D11, ghi spec nguồn | |

`packages/core/src/contracts/` là bản sinh cùng lúc cho code (type gộp + schema/errors/keys dạng module TS). Không sửa tay.
