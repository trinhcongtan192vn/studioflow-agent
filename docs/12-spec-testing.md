# D12 — Spec kiểm thử

**Phiên bản:** 1.3 · **Ngày:** 03/10/2026
**Dựa trên:** `constitution.md` Điều IV, X · `00-architecture.md` mục 12
**Phủ:** NFR-09, NFR-10, AC-M1-05, AC-M1-06 · **Tính năng:** 001 (khung), mọi tính năng

---

## 1. Loại test và công cụ

| Loại | Phạm vi | Chạy ở |
|---|---|---|
| **contract** | Schema artifact, tool Gateway, IPC, JSON-RPC worker, manifest | CI mọi commit |
| **integration** | Gateway + file system thật, HyperFrames thật, FFmpeg thật, worker Python (CPU) | CI mọi commit |
| **e2e** | Workflow chạy dự án mẫu từ brief đến MP4 (`sf test e2e`) | CI (không GPU, LLM phát lại) + máy tham chiếu |
| **gpu** | OmniVoice, ComfyUI, ASR GPU, lịch GPU (gắn nhãn `gpu`, `sf test gpu`) | Máy tham chiếu trước khi đóng tính năng |
| **ui** | Luồng UI chính | CI |
| **unit** | Hàm thuần (parser, cache key, xếp hạng nhạc) | CI |

Công cụ test cụ thể: tech-defaults.

Thứ tự viết theo constitution: contract → integration → e2e → unit; test viết và **fail trước** khi code.

## 2. Giả lập được phép
- **LLM:** ghi/phát lại (`fixtures/llm/<test>/<hash yêu cầu>.json`). Chế độ `SF_LLM=record` gọi thật và ghi; `replay` (mặc định CI) chỉ đọc, thiếu bản ghi → test fail.
- **GPU trên CI:** provider giả `tts.fake` (sinh sóng sin theo độ dài chữ), `image.fake` (ảnh màu đặc + chữ prompt), `asr.fake` (trả words chia đều) — đăng ký trong D4 mục 4.3, chỉ nạp khi `SF_GPU=0`.
- Không giả lập: file system, HyperFrames, FFmpeg, SQLite, IPC.

## 3. Dự án mẫu (hồi quy)
- Mỗi workflow có `extensions/workflows/<id>/samples/<sample>/`: `BRIEF.md`, `channel/` (hồ sơ kênh mẫu), `fixtures/llm/`, đầu ra mong đợi (`expected/`).
- Ngắn (dưới một phút); chạy hết đến MP4.
- **Kiểm:** artifact hợp lệ schema; `graph.status` toàn `fresh`; MP4 tồn tại, thời lượng, độ phân giải/fps, loudness khớp mong đợi trong dung sai; contact sheet khớp ảnh tham chiếu (khi dùng provider giả, kết quả xác định). Dung sai: tech-defaults mục 6.
- **Kịch bản sửa:** sửa 1 line → chỉ các job mong đợi chạy (so danh sách job với `expected/edit-jobs.json`).

## 4. Hồi quy khi thay đổi

| Thay đổi | Chạy |
|---|---|
| Lõi (`packages/core`) | contract + integration + e2e mọi workflow (CI) |
| Provider/model | contract provider + e2e workflow dùng capability đó; gpu trên máy tham chiếu |
| Workflow/thư viện bước/delta | e2e workflow liên quan |
| Schema artifact | contract + test migration với file mẫu mọi phiên bản cũ |
| Nâng HyperFrames/ComfyUI | toàn bộ e2e + gpu; Studio thủ công theo checklist (mục 6) |
| Đổi Agent Runtime | e2e với LLM `record` trên máy tham chiếu |

## 5. Test bắt buộc theo nguyên tắc
- **An toàn file (Điều VI):** bộ prompt đối nghịch ghi sẵn cố ghi/chạy lệnh ngoài Gateway → không lần nào lọt.
- **Ghi nguyên tử:** giết `core` lặp lại giữa lúc ghi → không file nào hỏng.
- **Khôi phục:** tắt app giữa job TTS/render → mở lại, trạng thái đúng (AC-M1-05).
- **Ownership:** agent ghi file cảnh khi Studio mở → `E_OWNER_CONFLICT`.

## 6. Checklist thủ công trên máy tham chiếu (trước khi đóng giai đoạn)
- Cài sạch theo hồ sơ của giai đoạn (UI-01).
- Chạy một video thật của kênh theo workflow chính của giai đoạn; ghi thời gian thao tác và thời gian máy (G1, G2).
- M3: 10 thao tác Studio của S6; commit; mở lại kiểm còn nguyên.
- Đo VRAM đỉnh trong cả quá trình (NFR-04).

## 7. CI
- Chạy trên Windows, không GPU: `SF_GPU=0`, `SF_LLM=replay`; mọi test phải pass để merge.
- Test `gpu` chạy trên máy tham chiếu; kết quả đính kèm vào PR của tính năng.
- Nền tảng CI và ngưỡng độ phủ: tech-defaults.
