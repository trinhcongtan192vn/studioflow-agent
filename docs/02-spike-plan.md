# D2 — Kế hoạch và báo cáo spike

**Phiên bản:** 1.0 · **Ngày:** 03/10/2026 · **Dựa trên:** `00-architecture.md` mục 15, `01-prd.md` mục 11

Spike trả lời các điểm chưa xác minh trước khi khóa thiết kế. Mỗi spike có câu hỏi, cách làm, chỉ số, ngưỡng đạt và tác động. Kết quả ghi vào mục **Báo cáo** của spike đó; giá trị `[chờ Sx]` trong các spec được thay bằng kết quả.

## 1. Quy ước chung

- **Máy tham chiếu:** Windows 11 x64, RTX 5060 Ti 16 GB, RAM 32 GB, SSD NVMe. Ghi phiên bản driver NVIDIA, CUDA, Python, Node, ComfyUI, HyperFrames.
- **Mã nguồn spike:** thư mục `spikes/Sx-<tên>/` trong repo (không thuộc 3 project chính), có `README.md` hướng dẫn chạy lại.
- **Dữ liệu mẫu chung:** `spikes/_fixtures/` — 3 kịch bản 300–500 từ (vi, de, en), 5 file giọng mẫu 5–10 giây, 10 prompt ảnh theo 2 phong cách, 50 bài nhạc nền (cho S11).
- **Thời hạn:** mỗi spike tối đa số ngày ghi trong bảng; hết hạn mà chưa có kết luận → ghi kết luận tạm + phương án dự phòng.
- **Thứ tự:** S3, S6, S2 trước (quyết định nhiều thiết kế nhất); S1, S8, S9 tiếp theo; còn lại song song.

## 2. Danh sách spike

| Mã | Hạng mục | Chặn | Thời hạn |
|---|---|---|---|
| S1 | OmniVoice | 006 | 2 ngày |
| S2 | Qwen-Image-2.1 qua ComfyUI | 018 | 2 ngày |
| S2b | NVFP4 cho 2.1 | 018 (không chặn) | 1 ngày |
| S2c | Qwen-Image-2.0 API | 018 (không chặn) | 0,5 ngày |
| S3 | HyperFrames workflow | 002, 011 | 3 ngày |
| S4 | Sub-agent frame | 011 | 1 ngày |
| S5 | Render | 013 | 1 ngày |
| S6 | Studio | 017, 025 | 3 ngày |
| S7 | Hoàn thiện | 010, 027 | 1 ngày |
| S8 | Agent SDK + Gateway | 003, 005 | 2 ngày |
| S9 | GPU | 019 | 1 ngày |
| S10 | Phim ngắn | 031, 032 | 2 ngày (làm trước M5) |
| S11 | Nhạc | 012, 021 | 1,5 ngày |
| S12 | Kiểm tra TTS bằng ASR | 010 | 1 ngày |
| S13 | Telemetry | 015 | 1 ngày |
| S14 | `refine-loop` | 009 | 2 ngày |
| S15 | Agent Runtime Port | — (sau M1) | 1 ngày |
| S16 | Cài đặt | 014 | 1,5 ngày |

## 3. Chi tiết

### S1 — OmniVoice
- **Câu hỏi:** clone tiếng Việt/Đức có tự nhiên không; tốc độ; VRAM; dung lượng; biến thể cảm xúc qua ref audio có dùng được không.
- **Cách làm:** clone 3 giọng (vi nam, vi nữ, de) từ file mẫu; sinh 3 kịch bản mẫu theo line; đo thời gian, VRAM đỉnh (`nvidia-smi` 100 ms), dung lượng model; nghe đánh giá MOS 1–5 (Tan chấm); thử 2 ref audio cảm xúc cho cùng giọng.
- **Chỉ số / ngưỡng đạt:** MOS ≥ 3,5 cho vi; thời gian sinh ≤ 0,5× thời lượng audio; VRAM đỉnh ≤ 6 GB; lưu/nạp giọng clone ổn định.
- **Tác động:** NFR-04; nếu MOS vi < 3,5 → Vbee làm mặc định tiếng Việt (D4 mục 4.3). Thay `[chờ S1]` trong D1 (NFR-04) và D4 mục 6 (ngân sách VRAM).

### S2 — Qwen-Image-2.1 qua ComfyUI
- **Câu hỏi:** sửa ảnh theo ảnh tham chiếu/vùng; ảnh RGBA; tách chủ thể; nhất quán style/seed; offload text encoder; API ComfyUI (tiến độ, hủy, giải phóng VRAM).
- **Cách làm:** dựng 4 workflow JSON (`t2i`, `edit_ref`, `edit_mask`, `t2i_rgba`), tham số hóa; gọi qua `POST /prompt`, theo dõi `/ws`, hủy bằng `POST /interrupt`, giải phóng bằng `POST /free {"unload_models":true,"free_memory":true}`; đo thời gian/ảnh ở 1024², 1344×768, 1664×928; chạy 10 prompt × 2 phong cách × 3 seed.
- **Ngưỡng đạt:** không OOM; ≤ 60 giây/ảnh 16:9 ~1,3 MP; RGBA có alpha sạch ở 8/10 ca; edit giữ bố cục ở 8/10 ca; `/free` trả VRAM về < 1 GB.
- **Tác động:** D4 mục ComfyUI (tên node, tham số workflow JSON); FR-IM-03 nếu RGBA/edit không đạt → dùng `remove-background`.

### S2b — NVFP4 cho 2.1
- **Cách làm:** cùng bộ prompt S2 với checkpoint NVFP4 cộng đồng; so thời gian và chất lượng (Tan chấm mù A/B).
- **Ngưỡng:** nhanh hơn ≥ 30% và không thua chất lượng ở ≥ 8/10 cặp → chuyển mặc định sang NVFP4.

### S2c — Qwen-Image-2.0 API
- **Cách làm:** chọn 1–2 nhà cung cấp; chạy 10 prompt kênh; ghi giá/ảnh, thời gian, có sửa ảnh/ảnh tham chiếu không, giới hạn tốc độ.
- **Đầu ra:** cấu hình provider `image.qwen20-api` trong D4.

### S3 — HyperFrames workflow
- **Câu hỏi:** (a) `faceless-explainer` gốc chạy được trên Windows; (b) chạy được khi bỏ bước sinh ảnh; (c) script nhận trường bổ sung (`beat_id`, `scene_id`) hay cần bản tạm; (d) tên file theo ID; (e) thuộc tính `data-sf-*` giữ nguyên qua `lint`, `check`, render; (f) thay TTS bằng audio có sẵn + `transcribe` mà `audio.mjs`/`captions.mjs` vẫn chạy; (g) định dạng chính xác `STORYBOARD.md`, `audio_meta.json`, `caption_groups.json`, frame packet mà script yêu cầu.
- **Cách làm:** clone HyperFrames ghim phiên bản; chạy workflow gốc với prompt mẫu; sửa dần theo từng câu hỏi; ghi lại mọi trường file thực tế.
- **Ngưỡng đạt:** (a)(b)(f) chạy hết đến MP4; (e) thuộc tính còn nguyên sau mọi lệnh.
- **Tác động:** D3 (định dạng artifact, chiến lược bản tạm), D6 (delta khi fork), FN-016. Nếu (e) sai → dùng `id="sf-…"`; nếu cả `id` bị đổi → bảng ánh xạ theo đường dẫn phần tử (D9).

### S4 — Sub-agent frame
- **Cách làm:** chạy 12 frame với 1, 2, 3 phiên con song song qua Agent SDK; đo thời gian tổng, token, lỗi lint, mức dùng hạn mức gói.
- **Ngưỡng:** chọn mức song song lớn nhất mà tỉ lệ lỗi lint không tăng và không chạm giới hạn tốc độ. Mặc định tạm 2–3.

### S5 — Render
- **Cách làm:** render dự án mẫu 3 phút và 10 phút, 1080p30, có/không media effect nặng, qua `@hyperframes/producer`; thử hủy giữa chừng; đo CPU/GPU/RAM.
- **Ngưỡng:** 10 phút không hiệu ứng nặng ≤ 30 phút; hủy dừng trong ≤ 5 giây và không để tiến trình mồ côi.
- **Tác động:** NFR-05, D4 job `render.video`.

### S6 — Studio
- **Câu hỏi:** (a) nhúng `hyperframes preview` trong `WebContentsView` của Electron; (b) chạy trên bản làm việc (thư mục khác project gốc); (c) Studio lưu keyframe/timing dưới dạng gì (thuộc tính, JSON, hay sửa mã GSAP); (d) ẩn trình sửa mã bằng chèn CSS/JS; (e) đọc ngược được gì (grade, overlay, điểm neo miệng); (f) điều khiển/đọc đầu phát từ ngoài (cho bảng caption); (g) thuộc tính lạ có giữ khi lưu.
- **Cách làm:** mở dự án mẫu, thực hiện 10 thao tác chỉnh tiêu biểu, diff file trước/sau mỗi thao tác.
- **Đầu ra bắt buộc:** bảng "thao tác → thay đổi trong file" làm cơ sở danh sách thuộc tính cho phép của `studio.commit` (D9).
- **Tác động:** D9; nếu (c) là mã GSAP → chọn phương án a/b/c ở D9 mục 3.

### S7 — Hoàn thiện
- **Cách làm:** caption tiếng Việt có dấu với 4 thành phần caption catalog; phụ đề 2 người nói; lấy schema `media-treatment --capabilities`; thử biến của 3 khối overlay.
- **Ngưỡng:** dấu tiếng Việt hiển thị đúng với font mặc định của kênh; schema capabilities đọc được dạng JSON.

### S8 — Agent SDK + Gateway
- **Câu hỏi:** tắt được công cụ ghi file/Bash có sẵn; nạp plugin local (`profile/`, `extensions/`); gắn Gateway dạng MCP server trong tiến trình (`createSdkMcpServer`) và dạng HTTP localhost; `canUseTool` chặn đúng; độ trễ tool call; phiên con chạy song song; đăng nhập gói Claude trong app desktop.
- **Ngưỡng:** agent không ghi/chạy lệnh được ngoài tool Gateway trong 20 thử nghiệm cố ý; độ trễ tool call nội bộ ≤ 50 ms (không tính việc thật).
- **Tác động:** D5.

### S9 — GPU
- **Cách làm:** đo VRAM từng engine (OmniVoice, ASR, Qwen-Image-2.1); thử OmniVoice + ASR ở chung; đo thời gian nạp lại từ RAM vs từ đĩa; chạy kịch bản 10 phút theo pha vs xen kẽ.
- **Đầu ra:** bảng ngân sách VRAM thật thay D4 mục GPU; chính sách ở chung.

### S10 — Phim ngắn
- **Cách làm:** 3–4 giọng tiếng Việt phân biệt (clone); 1 nhân vật × 8–10 biểu cảm từ ảnh tham chiếu (Qwen-Image-2.1 edit); lip-sync mức 1 với bộ miệng SVG 3 trạng thái trên 2 shot.
- **Ngưỡng:** người xem phân biệt được giọng; nhân vật nhận ra là một người ở ≥ 8/10 biểu cảm; miệng không lệch > 2 video frame.

### S11 — Nhạc
- **Cách làm:** phân tích 50 bài (BPM, energy, độ to) bằng librosa + pyloudnorm, so BPM với nhãn tay; thử 1–2 model CLAP cho 10 truy vấn mô tả; thử ducking bằng `media-use --local-only` và bằng FFmpeg `sidechaincompress`.
- **Ngưỡng:** BPM đúng ±3 ở ≥ 80% bài (cho phép nhân/chia đôi); truy vấn CLAP có bài phù hợp trong top 3 ở ≥ 7/10.
- **Tác động:** D8 (chọn model CLAP, cách ducking).

### S12 — Kiểm tra TTS bằng ASR
- **Cách làm:** sinh 200 line (vi), cố ý chèn 20 line đọc sai; đo tỉ lệ lỗi từ (WER) theo line với `transcribe`; tìm ngưỡng phân tách.
- **Đầu ra:** ngưỡng WER mặc định theo ngôn ngữ cho D4 `asr.align` (mặc định tạm 0,15).

### S13 — Telemetry
- **Cách làm:** OpenInference với phiên Agent SDK đăng nhập bằng gói Claude; xem phân cấp phiên con; xuất OTLP sang SQLite exporter tự viết và sang Phoenix.
- **Đầu ra:** D11 tên span/thuộc tính thực tế.

### S14 — `refine-loop`
- **Cách làm:** 5 đề tài × 2 kênh; so 1 lượt với 2–3 vòng; producer ChatGPT vs DeepSeek với cùng gói prompt; critic Claude; đo điểm rubric, token, thời gian, mức dùng hạn mức gói Claude của critic; Tan chấm mù bản cuối.
- **Đầu ra:** ngưỡng dừng (điểm tổng) mặc định cho D6 (tạm 8,0/10); model viết mặc định gợi ý.

### S15 — Agent Runtime Port
- **Cách làm:** chạy workflow mẫu M1 qua Claude API key (cùng SDK) và một runtime khác hỗ trợ MCP + skill; ghi số dòng adapter, chỗ phải sửa skill.

### S16 — Cài đặt
- **Cách làm:** cài sạch trên máy Windows mới theo 3 hồ sơ; cài Python bằng `uv`, ComfyUI + custom node tự động; ngắt mạng giữa lúc tải để thử tải tiếp.
- **Ngưỡng:** hồ sơ Chuẩn cài xong không cần thao tác tay ngoài đăng nhập; tải tiếp đúng sau khi đứt.
- **Tác động:** D4 trình quản lý model; số dung lượng trong D1 NFR-06.

## 4. Mẫu báo cáo (điền vào cuối mỗi spike)

```markdown
#### Báo cáo Sx — <ngày>
- Phiên bản thành phần: …
- Kết quả theo chỉ số: …
- Đạt ngưỡng: Có / Không / Một phần
- Kết luận: …
- Thay giá trị: [chờ Sx] ở <file>#<mục> → <giá trị mới>
- Đề xuất đổi spec: …
```
