# StudioFlow Agent — hướng dẫn cho Claude Code

Không dùng quy trình Spec Kit nữa (2026-10-10): không tạo `specs/NNN-*/`, không plan/tasks, không mã FR/AC.
Thư mục `specs/` và `.specify/` cũ chỉ còn để tham khảo lịch sử.

## Cách làm
1. Đọc code liên quan và mục `docs/` liên quan khi cần hiểu hành vi; `docs/contracts/` là định nghĩa schema/tool/manifest (test contract kiểm) — không định nghĩa lại.
2. Viết test cho thay đổi; mọi ghi file của app đi qua Gateway / `src/store`.
3. Một branch cho mỗi thay đổi → `npm run verify` ALL GREEN → `git merge --no-ff` vào `main` → push.
4. Commit ghi mô tả ngắn của thay đổi.
5. Chỉ hỏi (MCQ, có phương án đề xuất) khi là quyết định thật sự của người dùng.
6. Sửa `docs/` khi thay đổi làm tài liệu hành vi/contract sai đi.

Nền tảng: Windows 11 x64; Electron + React (TypeScript); lõi TypeScript/Node (`packages/core`); worker Python (`workers/gpu`).
