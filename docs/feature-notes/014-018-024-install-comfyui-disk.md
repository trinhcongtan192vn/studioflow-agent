# FN-014 / FN-018 / FN-024 — Cài đặt, ComfyUI, dung lượng

> **Ghi chú tính năng — không ràng buộc.** Đầu vào gợi ý cho `/specify` và `/plan` của tính năng 014 (`model-manager-install`), 018 (`image-comfyui-qwen`), 024 (`disk-management`). Hợp đồng ràng buộc ở D4 (mục 9.2, 10, 11); khi tính năng được đặc tả, `specs/<NNN>-*/spec.md` thay thế phần tương ứng.

## 1. Cài đặt và tải model (014) — Spike S16
- Onboarding (UI-01): chào → đăng nhập Claude → chọn hồ sơ cài đặt (hiện dung lượng) → tiến độ tải từng thành phần (tạm dừng/tiếp tục) → (tùy chọn) khóa OpenAI/DeepSeek/API ảnh.
- Hỏi xác nhận trước khi tải gói > 1 GB.
- Gỡ: xóa file model không còn provider nào cần; cập nhật `settings.installed`.
- URL/sha256 trong `models.yaml` điền khi cài thử ở S16.

## 2. ComfyUI (018) — Spike S2
- `provider.yaml` `defaults` của `image.qwen21-comfy`: GGUF Q4 (`Qwen-Image-2.1-Q4.gguf`, `qwen3vl_8b_w4a8`, VAE bf16), Euler, scheduler simple, cfg 1.0, 15 bước.
- Cài vào `<app-data>/providers/comfyui/`; model trỏ tới `<app-data>/models/` qua `extra_model_paths.yaml`.
- Khởi động: `python main.py --listen 127.0.0.1 --port <ngẫu nhiên> --disable-auto-launch` (+ cờ quản lý VRAM `[chờ S2]`).
- Sức khỏe: `GET /system_stats` mỗi 10 s; 3 lần lỗi liên tiếp → khởi động lại.
- Chạy: `POST /prompt` → tiến độ qua WebSocket `/ws?clientId=` → ảnh qua `/history/<id>` + `/view`. Hủy: `POST /interrupt`. Giải phóng VRAM: `POST /free {"unload_models": true, "free_memory": true}`.
- Story-documentary: ảnh nền 1664×928, vật thể 1024² RGBA, seed cố định theo scene (FN-023).

## 3. Dung lượng (024)
- Màn UI-10: cache theo kênh, `renders/`, `.sf/backups/`, model; nút dọn từng mục, hiện dung lượng sẽ giải phóng.
- Cảnh báo khi ổ còn < 15 GB; chặn job sinh/render khi < 5 GB (`E_DISK_LOW`).
- Cache: vượt `budget.cache_gb` → xóa ít dùng nhất tới 90% hạn mức; ưu tiên giữ mục của video có render phát hành trong 30 ngày.
- Giữ 5 render nháp gần nhất mỗi video; render phát hành không tự xóa; snapshot giữ 10; bản làm việc Studio xóa sau commit.
