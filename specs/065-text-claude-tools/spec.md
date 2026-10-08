# 065 — Bước Kịch bản lỗi `claude: error_max_turns`; "Kiểm tra lại" khi bước chưa có file

## Vấn đề
vd_p5qknxh5 (Shorts từ video YouTube, 2026-10-08): bước `script` lỗi `claude: error_max_turns` sau ~75 s. `text.claude` gọi Agent SDK `maxTurns: 1`, `allowedTools: []` — nhưng `allowedTools` chỉ là danh sách tự cho phép, công cụ dựng sẵn của Claude Code (WebFetch, Write…) vẫn bật. Brief có link YouTube → model gọi công cụ → cần lượt 2 → hết lượt.
Sau đó tab Tiến độ chỉ có "Kiểm tra lại" là nút chính cho mọi lỗi; bấm → kiểm gate trên file chưa từng được viết → `artifact_valid(SCRIPT.md): SCRIPT.md missing` (không sinh lại).

## Yêu cầu
- FR-TX-65-01: `text.claude` tắt toàn bộ công cụ dựng sẵn (`tools: []`) — lời gọi chữ thuần, một lượt.
- FR-UI-65-02: Lỗi bước không phải lỗi file (lỗi provider/agent) hoặc file đầu ra bị thiếu (`… missing`) → không có "Kiểm tra lại"; "Chạy lại" là nút chính, không hỏi xác nhận viết đè (tab Tiến độ và thẻ bước trong chat).

## AC
- `claude-text-limit.test.ts`: tùy chọn SDK có `tools: []`, `maxTurns: 1`.
- `progress-format.test.ts`, `chat-format.test.ts`: `claude: error_max_turns` và `artifact_valid(SCRIPT.md): SCRIPT.md missing` → chỉ Chạy lại (chính) + Quay lại; lỗi gate thường giữ Kiểm tra lại trước.
