# Research — 006

## R1. OmniVoice (Phụ lục A + README k2-fsa/OmniVoice, 2026-10-03)
- `OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cuda:0", dtype=torch.float16)`; `generate(text, voice_clone_prompt=…, speed, num_step)` trả list `np.ndarray` 24 kHz.
- Giọng clone tái dùng: `model.create_voice_clone_prompt(ref_audio, ref_text?)` → `prompt.save("voice.pt")`; `VoiceClonePrompt.load()`. Thiếu `ref_text` → Whisper tự phiên âm (tải thêm model ASR).
- Cài: PyTorch cu128 (RTX 50-series cần CUDA 12.8) rồi `pip install omnivoice`. Model 3,27 GB.
- **Decision**: ghim `omnivoice==0.2.1`, `torch==2.8.0+cu128`; `HF_HOME=<app-data>/models/hf`; đầu ra resample 24 → 48 kHz bằng `torchaudio.functional.resample` trong worker.

## R2. Vị trí môi trường engine
- **Decision**: `<app-data>/providers/python/omnivoice/` (D4 mục 9.3); mã worker (`sf_worker`) nạp qua `PYTHONPATH=<workers/gpu/src>` (dev) hoặc `resources/workers/gpu/src` (bản cài) — không cài `sf_worker` vào env để cập nhật mã không cần cài lại.
- Đường dẫn python ghi đè được bằng `SF_PYTHON_<ENGINE>` (test).

## R3. Chọn provider khi `SF_GPU=0`
- **Decision**: `ProviderRegistry.resolve` sau chuỗi cấu hình/dự phòng, nếu `SF_GPU=0` thử provider `*.fake` của capability (D12 mục 2: chỉ nạp khi `SF_GPU=0`).

## R4. Kiểm độ dài ref audio
- **Decision**: worker đọc độ dài bằng `soundfile.info`; 3–10 s theo Phụ lục A; ngoài khoảng → lỗi `E_AUDIO_UNSUPPORTED`.

## R5. Tạo giọng mẫu cho test thật
- Không có file giọng thật trong repo. Test `gpu` tạo ref 5 s tiếng Việt bằng chế độ *auto voice* của OmniVoice rồi clone từ đó — chỉ để kiểm đường chạy; chất lượng giọng (MOS, S1) do Tan đánh giá với giọng thật.
