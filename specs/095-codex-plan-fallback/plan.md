# 095 — Plan

Adapter TypeScript trong packages/core/agent dùng JSON-RPC stdio Codex app-server.
Không thêm project/dependency. Dynamic tools gọi Gateway; Read kiểm realpath và readRoots.
CODEX_HOME/cwd riêng, ép ChatGPT auth, xóa API key khỏi env. UI dùng IPC codex.login/status.
Runtime wrapper mang lịch sử, cooldown 5 phút; text service dùng cùng adapter không tool.

Gate constitution: spec đã cập nhật D5/D3; không câu hỏi mở. Logic core có CLI hiện có `sf frame`;
test fail trước. Không đổi hình dạng artifact/version, chỉ thêm khóa config và auth method tùy chọn.
Project ghi qua Gateway; OAuth Codex tự quản lý trong home riêng (D5 1.1).
Tool trace giữ nguyên Gateway; test protocol thật qua stdio, inference giả lập.

Tham chiếu: https://learn.chatgpt.com/docs/app-server (đọc 09/10/2026), protocol sinh từ CLI
0.162.0-alpha.17.2. API experimental cần kiểm lại khi nâng CLI.
