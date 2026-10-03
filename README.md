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
