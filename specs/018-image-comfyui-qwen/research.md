# Research — 018

## R1. Spike S2 (chạy thật 2026-10-04, RTX 5060 Ti 16 GB)
- ComfyUI **v0.38.2** (`Comfy-Org/ComfyUI`, commit `daeb5e5`) có sẵn node `TextEncodeQwenImage21` (prompt, negative_prompt, resolution, vae, nhóm autogrow `images.image_1..16`; trả positive, negative, latent theo ảnh tham chiếu đầu). Python 3.12, torch 2.8.0+cu128 (giống engine `omnivoice`).
- Model: GGUF **`Qwen-Image-2.1-Q4.gguf`** (5,96 GB, `realrebelai/Qwen-Image-2.1_GGUFs`) qua custom node **ComfyUI-GGUF** (`city96`, commit `6ea2651`) + text encoder `qwen3vl_8b_w4a8.safetensors` (6,31 GB) + VAE `qwen_image_2.1_vae_bf16.safetensors` (0,68 GB) từ `Comfy-Org/Qwen-Image-2.1`. Lựa chọn này khớp FN-018 (GGUF Q4, w4a8, VAE bf16); bản `int8_convrot` chính thức (7,26 GB, không cần custom node) để làm phương án thay thế.
- Tham số: euler, scheduler simple, cfg 1.0, **15 bước** (FN-018), `EmptyLatentImage` cho t2i; edit dùng latent của `TextEncodeQwenImage21` (theo kích thước ảnh nguồn).
- Đo (15 bước, sau khi nạp): 1664×928 **53,5 s**, 1344×768 **39,4 s**, 1024² RGBA **39,4 s**, edit 1344×768 **48,4 s**; lần đầu (nạp model) 59,6 s. VRAM khi nóng 12,9 GB; `POST /free {unload_models, free_memory}` → **1,26 GB** (trước khi chạy 1,19 GB). Không OOM. Đạt ngưỡng S2 (≤ 60 s/ảnh ~1,3 MP; `/free` < 1 GB trên mức nền).
- RGBA: VAE 2.1 giải mã 4 kênh → mọi PNG đều RGBA. Prompt dạng `This is an RGBA image with transparency. … The image has alpha channel and the background is transparent.` → 55% pixel trong suốt, viền sạch (kiểm trên nền caro). Ảnh không yêu cầu trong suốt có alpha 246–255 → adapter **làm phẳng alpha = 255** khi `transparent` không bật (manifest `alpha: false`).
- Edit (`edit_ref`): "làm thành ban đêm, có trăng" giữ nguyên bố cục/vật thể. `edit_mask`: Qwen-Image-2.1 không có inpaint mask thật — mask được đưa như ảnh tham chiếu thứ hai kèm chỉ dẫn "chỉ sửa vùng đánh dấu trong ảnh 2" (tài liệu Comfy: sửa có thể tràn ngoài vùng). Ghi rõ giới hạn.
- Đánh giá chất lượng 10 prompt × 2 phong cách × 3 seed: để Tan chấm khi chạy video thật (023).

## R2. Giấy phép
- Qwen-Image-2.1 theo **Qwen Research License**: chỉ phi thương mại; dùng thương mại cần giấy phép riêng (model-business@notice.qwencloud.com). Kênh YouTube kiếm tiền là thương mại.
- Quyết định Tan (2026-10-04): giữ 2.1 như PRD; cài phải **xác nhận giấy phép** (models.yaml `license: {id, url, commercial: false}`; CLI `--accept-license`; onboarding hiện điều khoản). Kiến trúc provider tách riêng → đổi model = thêm gói provider.

## R3. Độc lập
- App tự cài ComfyUI + model trong `<app-data>` (không dùng chung bản ComfyUI/model của ứng dụng khác trên máy — yêu cầu của Tan). `extra_model_paths.yaml` do app sinh, chỉ trỏ `<app-data>/models/`.

## R4. Vòng đời và giao tiếp
- Khởi động: `python main.py --listen 127.0.0.1 --port <tự do> --disable-auto-launch --extra-model-paths-config <app-data>/providers/comfyui/extra_model_paths.yaml --input-directory/--output-directory/--temp-directory/--user-directory <app-data>/providers/comfyui/run/…` (thư mục user phải tồn tại trước). Sẵn sàng khi `/system_stats` trả 200 (~25 s lần đầu).
- Cổng: chọn cổng tự do bằng `net.createServer().listen(0)` rồi đóng.
- Kết quả: `/history/<id>` → `outputs[*].images[0]` → `/view?filename&subfolder&type=output`. Tiến độ: WS `/ws?clientId=<id>` sự kiện `progress {value, max, prompt_id}`; lỗi `execution_error`. Không có WS (Node 22 có `WebSocket` toàn cục) vẫn chạy được nhờ thăm dò `/history` mỗi 1 s.
- Hủy: `POST /interrupt {prompt_id}` + `POST /queue {delete: [id]}`.
- Upload ảnh nguồn: `POST /upload/image` (multipart, `overwrite=true`, tên theo hash nội dung).

## R5. Workflow JSON (D4 9.2)
- File dạng API ComfyUI; chỗ thay thế là **chuỗi JSON nguyên** `"{{seed}}"` (thay bằng giá trị đúng kiểu: số cho width/height/seed/steps, chuỗi cho prompt) để tránh lỗi escape. Thêm chỗ thay thế ngoài D4 9.2: `{{cfg}}`, `{{sampler}}`, `{{scheduler}}`, `{{unet}}`, `{{clip}}`, `{{vae}}` lấy từ `provider.yaml.defaults`, và `{{resolution}}` (giữ đúng hợp đồng, chỉ mở rộng).
- Edit: node mã hóa thu ảnh tham chiếu về ngân sách `resolution` pixel (mặc định 1024² → 1664×928 thành 1376×768). Adapter đặt `resolution = 0` (giữ kích thước gốc, bội 32) khi ảnh nguồn ≤ 2048², ngược lại 2048. Test gpu: edit giữ 1664×928; t2i 1664×928 khi nóng 48,3 s.
- `reference_asset_ids` ở t2i: nạp như `images.image_N` (Ref2Image) — workflow `edit_ref` với latent rỗng theo width/height. Tối đa 10 ảnh.

## R6. Provider khác
- `bg.hf-remove-background`: `hyperframes remove-background <in> -o <out>.png --json` (bản HyperFrames ghim 0.8.115; lần đầu tự cài onnxruntime, ~0,6 s/ảnh CPU). Engine none (CPU).
- `image.qwen20-api` (S2c, tài liệu Alibaba Cloud Model Studio): `POST https://<workspace>.<region>.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`, `Authorization: Bearer <dashscope_api_key>`, body `{model, input:{messages:[{role:user, content:[{image?}…,{text}]}]}, parameters:{size:"W*H", n:1, negative_prompt, seed, prompt_extend:false, watermark:false}}`; ảnh ở `output.choices[0].message.content[].image` (URL hết hạn 24 h → tải ngay). Model mặc định `qwen-image-2.0` (t2i và edit, 1–3 ảnh vào). Endpoint workspace trong `settings.json.provider_settings["image.qwen20-api"].endpoint` (trường mới của `SettingsConfig`, D3). Giá/ảnh chưa đo (cần khóa) → `policy.paid_api.per_call_usd` dùng làm ước tính; không hỗ trợ RGBA. Chạy thật chờ Tan cung cấp khóa.
- `look`: style pack `extensions/styles/<id>/style.yaml` trường `image_prompt` (bổ sung D13) nối sau prompt. Chưa có style pack nào (027) → bỏ qua kèm ghi chú.

## R7. Cài đặt
- Mã ComfyUI và ComfyUI-GGUF tải dạng zip GitHub (`archive/<tag|commit>.zip`, sha256 tính khi ghim), giải nén bằng bsdtar (014), `strip` thư mục gốc. Môi trường Python engine `comfyui` theo `python_env` (014) với bước `-r {install}/ComfyUI/requirements.txt` (thêm thay thế `{app_data}` trong bước pip).
- Dev: dùng thẳng installer (`npm run sf -- model install comfyui` → `comfyui-env` → `qwen-image-2.1-q4 --accept-license`); đã chạy thật trên máy tham chiếu (môi trường cài lại trong ~10 s nhờ cache uv).
