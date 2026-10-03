# StudioFlow Agent — hướng dẫn cho Claude Code

Dự án theo **Spec-Driven Development** (GitHub Spec Kit). Bộ spec trong `docs/` là nguồn sự thật; code phục vụ spec.

## Trước mọi việc
1. Đọc `.specify/memory/constitution.md` (bản gốc: `docs/constitution.md`) và `docs/README.md`.
2. Đọc spec tính năng đang làm trong `specs/NNN-*/` và các mục `docs/` nó trích dẫn.
3. Không tự đoán: gặp chỗ chưa rõ hoặc mâu thuẫn giữa code và spec thì dừng, ghi `[NEEDS CLARIFICATION: …]` và hỏi.
4. Test trước, code sau (constitution Điều IV). Mọi ghi file của app đi qua Gateway.
5. Không định nghĩa lại schema/tool/manifest — dùng định nghĩa trong `docs/` (sau tính năng 002: `docs/contracts/`).
6. `docs/feature-notes/` và `docs/tech-defaults.md` là gợi ý, không ràng buộc; lệch thì ghi lý do trong `research.md`.
7. Commit ghi số tính năng (`NNN`) và mã FR/AC.

Nền tảng: Windows 11 x64; Electron + React (TypeScript); lõi TypeScript/Node (`packages/core`); worker Python (`workers/gpu`).

## Khởi tạo lần đầu (chỉ làm một lần)
1. `git init` (nếu chưa có), commit `docs/` + `CLAUDE.md`.
2. Cài Spec Kit (`uv tool install specify-cli`) rồi khởi tạo tại thư mục này với tích hợp Claude Code (xem `specify init --help` cho đúng cờ của phiên bản đã cài).
3. Chép `docs/constitution.md` đè lên `.specify/memory/constitution.md` (Spec Kit tạo bản mẫu).
4. Bắt đầu tính năng đầu tiên theo backlog `docs/README.md` mục 4: `001-repo-scaffold`, theo quy trình `docs/README.md` mục 3.3 (specify → clarify → plan → tasks → analyze → implement).
