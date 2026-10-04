# Research — 019

## R1. Một bộ lịch cho cả hàng đợi và lời gọi provider
- `graph.build` là một job không có `engine` nhưng bên trong gọi OmniVoice (`audio.line`) và ASR (`asr.line`); ảnh của bước workflow/agent chạy trong job `image.*` (engine comfyui). Chỉ khóa theo `engine` của job (004) thì `graph.build` và `image.generate` chạy song song → tràn VRAM 16 GB (OmniVoice ~6 GB + ComfyUI ~13 GB).
- **Decision**: `GpuScheduler` dùng chung; `runCapability` lấy lease cho mọi provider có `engine` GPU (một chỗ, phủ builder, ảnh, voice profile…); hàng đợi chỉ khởi chạy job có engine GPU khi `tryAcquire` thành công (job khác vẫn chạy). Re-entrant theo engine nên job comfyui gọi provider comfyui không tự khóa.
- Lớp tài nguyên engine: từ manifest provider đã đăng ký (`engine` + `resource`); `render` (HyperFrames: Chrome + FFmpeg NVENC) cố định `gpu-light` (ngân sách 2). Engine không biết → không giới hạn (CPU).

## R2. Giữ VRAM và đẩy ra
- Engine "giữ VRAM" sau khi chạy nếu có hook release (ComfyUI `/free`, worker Python `offload`); whisper.cpp/HyperFrames chạy tiến trình theo lần gọi → không giữ.
- Trước khi cấp lease cho E: engine đang giữ (không chạy) bị đẩy nếu E là heavy, hoặc engine đó là heavy, hoặc tổng ngân sách (đang chạy + đang giữ + E) > `gpu.vram_total_gb`. Đẩy theo thứ tự giữ lâu nhất trước.

## R3. Gom thay đổi lẻ
- Hàng đợi có `not_before` (đã có cho backoff) → job `graph.build` mới đặt `not_before = now + window`; tool gọi tiếp trong cửa sổ → gộp mục tiêu vào payload job đó (`JobQueue.updatePayload`, chỉ khi `queued`). Mục tiêu `null` (toàn bộ) thắng.
- Cửa sổ 3 s làm chậm mọi test gọi `tts.synthesize` → global setup đặt `SF_BATCH_WINDOW_MS=0`; test riêng đặt cửa sổ > 0.
