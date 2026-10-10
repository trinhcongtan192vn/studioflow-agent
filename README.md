# StudioFlow Agent

Ứng dụng desktop (Windows) sản xuất video YouTube qua agent chat: kịch bản, giọng đọc (OmniVoice), hình ảnh (Qwen-Image-2.1 qua ComfyUI), dựng và render (HyperFrames).

- Tài liệu và quy trình: [`docs/README.md`](docs/README.md)
- Kiến trúc: [`docs/00-architecture.md`](docs/00-architecture.md)
- Yêu cầu sản phẩm: [`docs/01-prd.md`](docs/01-prd.md)
- Hướng dẫn cho Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Bắt đầu (Windows 11 x64)

```powershell
npm run setup     # kiểm công cụ, cài phụ thuộc Node + Python, bật git hooks
npm run verify    # build + lint + test 3 project
npm run sf -- --help
npm run package   # bản cài NSIS vào release/
```

Chi tiết: [`specs/001-repo-scaffold/quickstart.md`](specs/001-repo-scaffold/quickstart.md).

## Fallback bằng gói ChatGPT (095)

Trong **Cài đặt → Model AI → Dự phòng khi Claude hết hạn mức**, bật fallback và bấm
**Đăng nhập ChatGPT**, rồi **Kiểm tra kết nối**. Cần Codex CLI có `app-server`/dynamic tools
(đã kiểm protocol 0.162.0-alpha.17.2). App tự tìm CLI trong PATH và extension ChatGPT của
VS Code/VS Code Insiders; có thể nhập đường dẫn `codex.exe` để chọn bản khác.
Để trống model để dùng mặc định Codex. Phiên đăng nhập riêng của app lưu tại app-data/codex.

Chat, workflow và viết/chấm text ưu tiên Claude; gặp lỗi hạn mức thì dùng Codex bằng gói đã đăng nhập,
nghỉ Claude 5 phút rồi thử lại. Fallback không dùng API key, không mua credit. Cả hai cùng hết hạn mức
thì dừng chờ. Chi tiết: [`specs/095-codex-plan-fallback/spec.md`](specs/095-codex-plan-fallback/spec.md).
