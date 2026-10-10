# 095 — Tasks

- [x] Cập nhật D5, D3, defaults và sinh contracts.
- [x] Test fail trước: fallback runtime, Codex stdio, text fallback.
- [x] Adapter Codex ChatGPT, dynamic tools, quyền đọc, usage, interrupt/close.
- [x] Runtime fallback và text fallback; Settings + đăng nhập ChatGPT.
- [x] Kiểm type/build, lint, contracts và hồi quy liên quan (69 core + 100 desktop; 10 test ảnh/render chạy lại ngoài sandbox).
- [ ] Nghiệm thu inference thật sau đăng nhập ChatGPT trong app.
- [x] Tự dò CLI trong PATH và extension VS Code/Insiders, ưu tiên cấu hình thủ công; test khi PATH rỗng và khởi động CLI thật thành công.

Kiểm CLI thật: initialize/account/read/thread/start + dynamicTools qua stdio thành công, không gọi model.
Full core trong sandbox có lỗi GPU/quyền Windows và timeout khi chạy nhiều tiến trình; không coi lần đó là full pass.
Nhóm ảnh/render/atomic/shorts chạy lại ngoài sandbox với maxWorkers=2: 10/10 qua.
