# 095 — Fallback Claude sang Codex bằng gói ChatGPT

Dựa trên D5 1.1, 3–5; D3 7.2; D4 text.generate/text.review; D10 Settings.

- FR-AG-95-01: Claude báo hạn mức → tiếp tục bằng Codex app-server với ChatGPT plan;
  không dùng API key, không mua credit. Mỗi lượt chuyển tối đa một lần. Lỗi khác không chuyển.
- FR-AG-95-02: giữ ngữ cảnh và kết quả tool, quyền Gateway và điểm duyệt; ngắt/đóng ngăn chuyển.
  Tạm bỏ qua Claude 5 phút sau lỗi hạn mức rồi thử lại; không lặp vô hạn khi cả hai hết hạn mức.
- FR-AG-95-03: text.generate/review cũng fallback; trả model, usage thật, chi phí API bằng 0.
- FR-UI-95-04: Settings cho bật/tắt, model (trống = mặc định Codex), đường dẫn CLI (trống = PATH),
  đăng nhập ChatGPT và kiểm tra trạng thái. Home riêng ở app-data/codex, cwd ở home riêng;
  không nạp cấu hình, hook, MCP, skill từ kênh hay home người dùng.

Kiểm: fake app-server qua stdio (protocol thật, không inference); kiểm quyền/tool, luồng delta,
usage, auth API-key bị từ chối, lỗi/exit/timeout, ngắt; runtime giả kiểm fallback/history/cooldown;
test text fallback. Live inference chỉ dùng gói ChatGPT đã đăng nhập.

Giới hạn: Codex cần CLI hỗ trợ dynamicTools và gói còn hạn mức. Không bảo đảm sử dụng vô hạn.
