# D1 — PRD: StudioFlow Agent

**Phiên bản:** 1.0 (bản nháp) · **Ngày:** 03/10/2026 · **Chủ sở hữu:** Tan
**Dựa trên:** `00-architecture.md` v3.0 · **Quy ước:** xem `README.md`

---

## 1. Bối cảnh và vấn đề

Tan vận hành nhiều kênh YouTube (lịch sử Việt Nam, tâm lý/triết học tiếng Đức, khoa học phổ thông tiếng Anh, tóm tắt sách, sách nói…). Quy trình hiện tại ghép nhiều công cụ rời (LLM viết kịch bản, TTS, sinh ảnh, dựng), tốn thời gian chuyển file, khó sửa một phần mà không làm lại cả video, và không giữ được phong cách riêng của từng kênh một cách nhất quán.

StudioFlow Agent là ứng dụng desktop nơi người dùng **trò chuyện với một agent** để đi từ ý tưởng đến file MP4, với các công cụ chuyên dụng (OmniVoice, Qwen-Image-2.1 qua ComfyUI, HyperFrames) chạy trên máy, và **chỉ sinh lại phần bị ảnh hưởng** khi sửa.

## 2. Người dùng

| Vai | Mô tả |
|---|---|
| **Người sản xuất (duy nhất)** | Một người dùng cá nhân, hiểu sản phẩm và kỹ thuật, không viết code tay. Quản lý 3–6 kênh, mỗi kênh có phong cách, ngôn ngữ, giọng đọc riêng. Làm việc trên một máy Windows có GPU |

Không có đa người dùng, phân quyền, hay chia sẻ dự án.

## 3. Mục tiêu và chỉ số

| Mã | Mục tiêu | Chỉ số | Mục tiêu số (chốt lại sau spike) |
|---|---|---|---|
| G1 | Giảm thời gian làm một video | Thời gian người dùng thao tác cho một video `narrated-explainer` 8–12 phút, từ brief đến MP4 phát hành | ≤ 60 phút thao tác; thời gian máy chạy không tính |
| G2 | Sửa nhanh, không làm lại | Sửa một câu thoại → MP4 mới | Chỉ sinh lại audio câu đó + phần phụ thuộc; ≤ 10 phút máy chạy `[chờ S5]` |
| G3 | Giữ phong cách kênh | Tỉ lệ bản kịch bản qua `refine-loop` được duyệt không phải sửa lớn | ≥ 70% sau 10 video đầu của kênh |
| G4 | Dễ mở rộng | Thêm một thể loại video mới | Chỉ thêm gói workflow + dự án mẫu, không sửa lõi/UI |
| G5 | Chạy được trên máy hiện có | Một video MVP chạy trọn trên RTX 5060 Ti 16 GB / RAM 32 GB | Không lỗi hết bộ nhớ GPU |

## 4. Phạm vi theo giai đoạn

| Giai đoạn | Người dùng làm được |
|---|---|
| **M0 Nền móng** | (Kỹ thuật) Gateway, OmniVoice, job/cache/provenance, Agent Runtime Port. Sinh audio một câu qua chat, chạy lại lấy từ cache |
| **M1 Bản nội bộ** | Tạo kênh; tạo video `narrated-explainer` với hình vẽ bằng code + ảnh tự nạp; kịch bản qua `refine-loop`; giọng OmniVoice; caption; nhạc nền từ kho local; render MP4; sửa qua chat; xem trước trong Studio |
| **M2 MVP** | Thêm sinh/sửa ảnh Qwen-Image-2.1; `story-documentary`; build graph đầy đủ (sửa một câu chỉ sinh lại phần liên quan); tìm nhạc bằng mô tả (CLAP); hồ sơ kênh đầy đủ + kiểm tra hồ sơ |
| **M3 Chỉnh trực quan** | Chỉnh trong Studio và lưu an toàn; bảng caption; look màu, media effect, overlay; bảng chi phí; rubric theo kênh; Phoenix |
| **M4** | `essay-audiobook`, `shorts` (9:16); hồ sơ các kênh còn lại |
| **M5 / M5b** | `short-film` nhiều nhân vật + người dẫn / lip-sync mức 1 |

**Ngoài phạm vi:** quản lý/kiểm tra giấy phép (người dùng tự xử lý); sinh video bằng AI; lip-sync theo âm vị/AI; đăng YouTube tự động; đa người dùng; chạy trên cloud hoặc đồng bộ cloud; phát hành app cho người khác; macOS/Linux; HDR; tracking/mask.

## 5. Môi trường và ràng buộc

- **Hệ điều hành:** Windows 11 x64.
- **Phần cứng tham chiếu:** NVIDIA RTX 5060 Ti 16 GB VRAM, RAM 32 GB, SSD còn trống ≥ 50 GB.
- **Tài khoản:** bắt buộc gói Claude (agent chạy qua Claude Agent SDK). Khóa OpenAI/DeepSeek/API ảnh là tùy chọn.
- **Mạng:** cần cho Claude và LLM ngoài; mọi việc sinh giọng, ảnh, dựng, render chạy local.
- **Công nghệ:** Electron + React (TypeScript); lõi TypeScript/Node; worker GPU Python; HyperFrames (Node 22+, FFmpeg); ComfyUI headless.
- **Ngôn ngữ giao diện:** tiếng Việt. **Ngôn ngữ nội dung video:** tiếng Việt, tiếng Đức, tiếng Anh (cấu hình theo kênh).
- **Định dạng đầu ra mặc định:** MP4 H.264, 1920×1080, 30 fps, AAC 48 kHz, độ to −14 LUFS. Shorts: 1080×1920, ≤ 60 giây.

## 6. Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| Kênh (channel) | Một thư mục project; chứa hồ sơ kênh, giọng, asset, nhạc, các video |
| Hồ sơ kênh (profile) | Quy tắc, phong cách, rubric, gói prompt, giá trị mặc định của kênh |
| Video | Một dự án HyperFrames trong kênh |
| Beat / Scene / Frame / Layer | Đơn vị nội dung / bối cảnh / dựng / lớp hình (xem kiến trúc mục 4) |
| Workflow | Quy trình theo thể loại video, gồm các bước có điểm duyệt |
| Điểm duyệt | Chỗ workflow dừng chờ người dùng duyệt |
| `refine-loop` | Vòng viết → chấm → sửa tự động 2–3 lần |
| Render nháp / phát hành | Nháp: gate chỉ cảnh báo, có dấu "NHÁP". Phát hành: mọi gate phải qua |
| Nút ghim | Frame đã chỉnh tay trong Studio, không bị sinh đè nếu chưa hỏi |

## 7. Hành trình người dùng chính

| Mã | Hành trình | Giai đoạn |
|---|---|---|
| J1 | **Cài đặt và onboarding:** mở app lần đầu → đăng nhập Claude → chọn hồ sơ cài đặt (Tối thiểu/Chuẩn/Đầy đủ) → app tải thành phần cần thiết với tiến độ → (tùy chọn) nhập khóa API | M1 (Chuẩn), M2 (Đầy đủ) |
| J2 | **Tạo kênh:** chọn thư mục → trò chuyện với agent để khai báo ngôn ngữ, phong cách, giọng (clone từ file mẫu), look, quy tắc → agent tạo hồ sơ kênh → kiểm tra hồ sơ | M1 |
| J3 | **Tạo video:** trong kênh, nhập ý tưởng → agent hỏi để chốt brief → chọn workflow → chạy các bước, dừng ở điểm duyệt (brief, kịch bản, storyboard, bản cuối) → render nháp → render phát hành | M1 |
| J4 | **Sửa qua chat:** "đổi câu thứ 3 của đoạn mở đầu", "làm ảnh scene 2 tối hơn", "thay nhạc nhẹ hơn" → agent sửa artifact → build graph chỉ chạy lại phần bị ảnh hưởng → xem trước | M1 (cơ bản), M2 (đầy đủ) |
| J5 | **Chỉnh trong Studio:** mở Studio → kéo vị trí, kích thước, timing, keyframe → lưu → app kiểm và ghi → frame được đánh dấu đã chỉnh tay | M3 |
| J6 | **Sửa caption:** trong bảng caption, kéo mép cụm, tách/gộp cụm, sửa chữ | M3 |
| J7 | **Nạp nhạc:** kéo thả file nhạc vào app hoặc chat → điền tag, ghi công (tùy chọn) → bài được phân tích và vào kho | M1 |
| J8 | **Theo dõi job và chi phí:** xem job đang chạy, hủy, thử lại; xem chi phí token/API theo video; xem dung lượng đĩa | M1 (job), M3 (chi phí) |
| J9 | **Mở lại dự án:** mở kênh/video đã làm → app khôi phục trạng thái workflow, điểm duyệt đang chờ, job dở dang | M1 |

## 8. Yêu cầu chức năng

Cột **GĐ** = giai đoạn phải có. Spec chi tiết ở cột **Spec**.

### 8.1 Workspace và kênh (WS)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-WS-01 | Người dùng PHẢI mở được một thư mục làm kênh; app nhận diện kênh qua `channel.json` hoặc đề nghị khởi tạo | M1 | D3 |
| FR-WS-02 | App PHẢI hiển thị explorer chỉ đọc của kênh; người dùng không sửa/xóa/đổi tên file từ app | M1 | D10 |
| FR-WS-03 | Người dùng PHẢI tạo được nhiều video trong một kênh; mỗi video là một thư mục `videos/<id>/` | M1 | D3 |
| FR-WS-04 | App PHẢI khôi phục trạng thái workflow, điểm duyệt và job dở dang khi mở lại kênh/video (J9) | M1 | D4, D6 |
| FR-WS-05 | App PHẢI chạy migration schema khi mở project có `schema_version` cũ, sao lưu trước khi migrate | M1 | D3 |
| FR-WS-06 | App PHẢI phát hiện file trong project bị sửa ngoài app và cảnh báo | M3 | D9 |

### 8.2 Chat và agent (CH)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-CH-01 | Người dùng PHẢI trò chuyện với agent trong ngữ cảnh một kênh/video; agent dùng hồ sơ kênh và trạng thái video hiện tại | M1 | D5 |
| FR-CH-02 | Chat PHẢI hiển thị luồng trả lời, các tool agent gọi, và job phát sinh | M1 | D10 |
| FR-CH-03 | Người dùng PHẢI đính kèm được file (ảnh, nhạc, giọng mẫu) vào chat; app đưa vào đúng thư mục qua Gateway | M1 | D4 |
| FR-CH-04 | Người dùng PHẢI chọn được frame/mốc thời gian/lớp/cụm phụ đề trong preview để đính kèm làm ngữ cảnh cho chat | M3 | D10 |
| FR-CH-05 | Agent PHẢI hỏi người dùng trước khi: sinh hàng loạt, render, gọi API có phí vượt ngưỡng, xóa/ghi đè phần đã duyệt hoặc đã chỉnh tay | M1 | D5 |
| FR-CH-06 | Agent KHÔNG ĐƯỢC ghi file hay chạy lệnh ngoài tool của Gateway | M0 | D5 |
| FR-CH-07 | Lịch sử chat PHẢI được lưu theo video và mở lại được | M1 | D3 |

### 8.3 Workflow và điểm duyệt (WF)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-WF-01 | Agent PHẢI chốt brief với người dùng (intent layer) và ghi `BRIEF.md` trước khi chạy workflow | M1 | D6 |
| FR-WF-02 | App PHẢI hiển thị tiến độ workflow (bước, trạng thái, điểm duyệt) đọc từ manifest, không có mã UI riêng cho từng workflow | M1 | D6, D10 |
| FR-WF-03 | Tại điểm duyệt, người dùng PHẢI duyệt, yêu cầu sửa (qua chat) hoặc quay lại bước trước | M1 | D6 |
| FR-WF-04 | Gate PHẢI kiểm được: artifact hợp lệ schema, không còn nút lỗi thời, đã duyệt | M1 | D6 |
| FR-WF-05 | Workflow `narrated-explainer` | M1 | D6, FN-016 |
| FR-WF-06 | Workflow `story-documentary` | M2 | D6, FN-023 |
| FR-WF-07 | Workflow `essay-audiobook`, `shorts` | M4 | D6, FN-029, FN-030 |
| FR-WF-08 | Workflow `short-film` (nhiều nhân vật, người dẫn, animatic) | M5 | D6, FN-031 |
| FR-WF-09 | Lip-sync mức 1 cho `short-film` | M5b | D6, FN-032 |
| FR-WF-10 | Chế độ tự động (mặc định): agent điều phối và tự quyết các bước; chỉ dừng ở điểm chốt (brief, truyện, kịch bản, chọn giọng khi chưa có, duyệt bản nháp trước render phát hành); tắt được theo kênh/video | Sau M5 | D6, 034 |

### 8.4 Kịch bản và `refine-loop` (SC)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-SC-01 | Kịch bản, tiêu đề, mô tả PHẢI do model người dùng chọn viết (ChatGPT, DeepSeek…; mặc định Claude khi chưa có khóa ngoài) dùng gói prompt của kênh | M1 | D6 |
| FR-SC-02 | `refine-loop` PHẢI chạy tự động ít nhất 2, tối đa 3 vòng; critic khác model với producer | M1 | D6 |
| FR-SC-03 | Người dùng PHẢI chỉ duyệt bản cuối, kèm tóm tắt điểm qua các vòng và vấn đề đã sửa/còn lại | M1 | D6, D10 |
| FR-SC-04 | Khi ngân sách không đủ 2 vòng, app PHẢI hỏi trước; nếu cạn giữa chừng, đánh dấu "chưa đủ vòng" và cho người dùng chọn thêm ngân sách / chấp nhận / hủy | M1 | D6 |
| FR-SC-05 | `SCRIPT.md` PHẢI đánh dấu beat và line (người nói, chỉ dẫn diễn xuất) để các bước sau dùng ID | M1 | D3 |
| FR-SC-06 | Người dùng PHẢI chọn được model viết theo kênh hoặc theo video | M1 | D4, D10 |
| FR-SC-07 | `refine-loop` cho storyboard | M2 | D6 |

### 8.5 Giọng đọc (VO)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-VO-01 | Người dùng PHẢI tạo được giọng kênh bằng cách clone từ file mẫu 3–10 giây (qua chat) và nghe thử | M1 | D4 |
| FR-VO-02 | App PHẢI sinh audio theo từng line, ghi `audio_meta.json` (line, word, thời lượng) | M0 | D3, D4 |
| FR-VO-03 | App PHẢI kiểm đọc sai bằng ASR so với kịch bản; line vượt ngưỡng được sinh lại hoặc báo `[chờ S12]` | M1 | D4 |
| FR-VO-04 | Sửa một line chỉ sinh lại audio line đó | M0 | D4 |
| FR-VO-05 | Nhiều giọng trong một video (nhân vật + người dẫn), biến thể cảm xúc | M5 | D4, FN-031 |
| FR-VO-06 | Khi chưa có file giọng mẫu, app PHẢI gợi ý giọng tạo từ mô tả (giới tính, tuổi, cao độ) cho người dẫn và từng nhân vật để nghe thử và chọn; giọng chọn dùng ổn định cho cả video | Sau M5 | D4, 033 |

### 8.6 Hình ảnh và asset (IM)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-IM-01 | Frame PHẢI dùng được hình vẽ bằng code (SVG/HTML, biểu đồ, chữ) và ảnh người dùng nạp | M1 | D6, FN-common |
| FR-IM-02 | App PHẢI sinh ảnh bằng Qwen-Image-2.1 local qua ComfyUI, theo look của kênh | M2 | D4 |
| FR-IM-03 | App PHẢI sửa ảnh theo ảnh tham chiếu/vùng và sinh ảnh nền trong suốt | M2 | D4 |
| FR-IM-04 | Người dùng CÓ THỂ chọn Qwen-Image-2.0 qua API làm provider ảnh | M2 | D4 |
| FR-IM-05 | Kênh PHẢI có thư viện asset dùng lại giữa các video | M2 | D3 |

### 8.7 Dựng và hoàn thiện (CP)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-CP-01 | Agent PHẢI dựng từng frame thành sub-composition HyperFrames bằng sub-agent (mặc định 2 song song `[chờ S4]`) và lắp `index.html` | M1 | D6 |
| FR-CP-02 | Caption động PHẢI lấy chữ từ `SCRIPT.md`, mốc thời gian từ căn chỉnh ASR | M1 | D6, FN-common |
| FR-CP-03 | Transition giữa scene/frame theo catalog HyperFrames | M1 | D6, FN-common |
| FR-CP-04 | Look màu theo kênh + biến thể theo scene | M3 | D6, FN-common |
| FR-CP-05 | Media effect (dry-run trước khi áp) và overlay theo quy tắc kênh | M3 | D6, FN-common |

### 8.8 Nhạc (MU)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-MU-01 | Người dùng PHẢI nạp nhạc/SFX vào kho (kênh hoặc cấp app) với trường tùy chọn: nguồn, URL, tag, văn bản ghi công | M1 | D8 |
| FR-MU-02 | App PHẢI phân tích bài khi nạp (thời lượng, BPM, energy, độ to) | M1 | D8 |
| FR-MU-03 | Agent PHẢI tìm nhạc theo thời lượng/BPM/tag/từ khóa | M1 | D8 |
| FR-MU-04 | Agent PHẢI tìm nhạc bằng mô tả tự nhiên (embedding CLAP) | M2 | D8 |
| FR-MU-05 | Nhạc PHẢI được giảm âm dưới giọng (ducking) và chuẩn hóa âm lượng | M1 | D8 |
| FR-MU-06 | App PHẢI tự sinh `CREDITS.txt` từ văn bản ghi công của bài/asset đã dùng | M1 | D8 |

### 8.9 Studio và caption (ST)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-ST-01 | Người dùng PHẢI xem trước video trong Studio nhúng trong app | M1 | D9 |
| FR-ST-02 | Người dùng PHẢI chỉnh được vị trí, kích thước, timing, keyframe, tinh chỉnh grade/hiệu ứng, trộn audio trong Studio; lưu qua `studio.commit` | M3 | D9 |
| FR-ST-03 | Trình sửa mã của Studio PHẢI bị ẩn; thay đổi ngoài danh sách thuộc tính cho phép bị từ chối kèm giải thích | M3 | D9 |
| FR-ST-04 | Frame đã chỉnh tay PHẢI không bị sinh đè nếu chưa hỏi; khi lỗi thời, người dùng chọn giữ / sinh lại và áp lại chỉnh tay / sinh lại bỏ chỉnh tay | M3 | D4, D9 |
| FR-ST-05 | Bảng caption PHẢI cho kéo mép cụm, tách/gộp cụm, sửa chữ, có trình phát audio và dạng sóng | M3 | D9 |
| FR-ST-06 | Khi Studio đang mở, agent không được ghi file cảnh của video đó | M3 | D5, D9 |

### 8.10 Render (RD)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-RD-01 | Người dùng PHẢI render nháp (có dấu "NHÁP", gate chỉ cảnh báo) và render phát hành (mọi gate phải qua) | M1 | D4 |
| FR-RD-02 | Render PHẢI có tiến độ, hủy được, xuất theo output profile của video | M1 | D4 |
| FR-RD-03 | Bản phát hành PHẢI kèm `CREDITS.txt` (nếu có ghi công) và gợi ý tiêu đề/mô tả đã qua `refine-loop` | M1 | D6 |

### 8.11 Job, GPU, cài đặt (OP)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-OP-01 | Việc nặng PHẢI chạy dạng job: tiến độ, hủy, thử lại có giới hạn, kết quả từng phần | M0 | D4 |
| FR-OP-02 | GPU PHẢI chạy một job nặng một lúc, theo pha (TTS → ảnh → render) | M2 | D4 |
| FR-OP-03 | Kết quả sinh PHẢI được cache theo nội dung; chạy lại cùng đầu vào lấy từ cache | M0 | D4 |
| FR-OP-04 | Bản cài không chứa model; app tải model khi cần (báo dung lượng, tiến độ, tải tiếp khi đứt, kiểm checksum) | M1 | D4 |
| FR-OP-05 | App PHẢI cài và quản lý vòng đời ComfyUI headless (khởi động, kiểm tra sức khỏe, khởi động lại) | M2 | D4 |
| FR-OP-06 | App PHẢI có màn dung lượng, dọn cache theo hạn mức, cảnh báo đĩa thấp | M2 | D4, D10 |
| FR-OP-07 | Khóa API PHẢI lưu trong kho bí mật của Windows (Credential Manager) | M1 | D5 |

### 8.12 Quan sát và chi phí (OB)

| Mã | Yêu cầu | GĐ | Spec |
|---|---|---|---|
| FR-OB-01 | App PHẢI ghi trace cục bộ cho bước, tool, LLM, job, vòng refine | M1 | D11 |
| FR-OB-02 | Mỗi file sinh ra PHẢI có provenance (provider, model, tham số, seed, nguồn) | M0 | D3 |
| FR-OB-03 | App PHẢI báo chi phí token/API theo video và theo bước; có ngân sách theo kênh/video | M3 | D11 |
| FR-OB-04 | Người dùng CÓ THỂ bật Arize Phoenix cục bộ để xem trace chi tiết | M3 | D11 |

## 9. Yêu cầu phi chức năng

| Mã | Yêu cầu | Mục tiêu |
|---|---|---|
| NFR-01 | An toàn file | Mọi ghi vào project qua Gateway; không có lệnh xóa/ghi ra ngoài project; sao lưu trước migration và trước ghi đè phần đã duyệt |
| NFR-02 | Bền vững khi lỗi | App/worker crash không làm hỏng artifact (ghi nguyên tử: ghi file tạm rồi đổi tên); job dở dang tiếp tục hoặc chạy lại được khi mở lại |
| NFR-03 | Phản hồi UI | Thao tác UI không bị chặn bởi job; chat hiển thị token đầu ≤ 3 giây sau khi gửi (khi mạng bình thường) |
| NFR-04 | Hiệu năng GPU | Không lỗi hết VRAM ở cấu hình tham chiếu; ảnh 1080p ≤ 60 giây/ảnh `[chờ S2]`; TTS ≤ 0,5× thời lượng audio `[chờ S1]` |
| NFR-05 | Hiệu năng render | Render 10 phút 1080p30 không hiệu ứng nặng ≤ 30 phút `[chờ S5]` |
| NFR-06 | Đĩa | Hồ sơ Đầy đủ ≤ 25 GB; cache có hạn mức theo kênh (mặc định 20 GB) |
| NFR-07 | Riêng tư | Kịch bản, giọng, asset không rời máy trừ khi gửi tới LLM/API người dùng đã cấu hình; trace lưu cục bộ |
| NFR-08 | Khả năng thay thế | Đổi provider/model/runtime không phải sửa skill/workflow; chỉ thêm adapter + chạy hồi quy |
| NFR-09 | Kiểm thử | Mỗi workflow có dự án mẫu 30–60 giây chạy được tự động trong hồi quy |
| NFR-10 | Tương thích | Pin phiên bản HyperFrames, ComfyUI, custom node, model; nâng cấp chỉ khi qua hồi quy |

## 10. Tiêu chí nghiệm thu theo giai đoạn

### M0
- **AC-M0-01:** Qua chat, yêu cầu đọc một câu → có file audio + `audio_meta.json` + provenance.
- **AC-M0-02:** Gửi lại đúng yêu cầu đó → kết quả lấy từ cache, không gọi OmniVoice.
- **AC-M0-03:** Agent thử ghi file/chạy lệnh không qua Gateway → bị chặn và ghi log.

### M1 (bản nội bộ)
- **AC-M1-01:** Từ ý tưởng, hoàn thành video `narrated-explainer` 3–5 phút đến MP4 phát hành, qua đủ điểm duyệt (brief, kịch bản, storyboard, bản cuối).
- **AC-M1-02:** Kịch bản qua `refine-loop` ≥ 2 vòng với critic khác model; người dùng thấy tóm tắt điểm qua các vòng.
- **AC-M1-03:** Sửa một câu qua chat → chỉ audio câu đó và caption liên quan được sinh lại (kiểm qua log job).
- **AC-M1-04:** Nạp 10 bài nhạc → agent chọn được bài theo yêu cầu "nhạc chậm, ~90 BPM, dài ≥ 3 phút"; nhạc được ducking dưới giọng.
- **AC-M1-05:** Tắt app giữa lúc đang render → mở lại thấy trạng thái đúng và render lại được.
- **AC-M1-06:** Cài mới trên máy tham chiếu với hồ sơ Chuẩn chỉ cần đăng nhập Claude và chờ tải.

### M2 (MVP)
- **AC-M2-01:** Hoàn thành video `story-documentary` 8–12 phút có ảnh sinh bằng Qwen-Image-2.1, không lỗi hết VRAM.
- **AC-M2-02:** Sửa một câu thoại trong video 10 phút → chỉ phần phụ thuộc chạy lại (audio câu, caption, thời lượng frame chứa nó, lắp lại).
- **AC-M2-03:** Đổi provider ảnh (local ↔ API) → các ảnh liên quan được đánh dấu lỗi thời và sinh lại khi yêu cầu.
- **AC-M2-04:** Tìm nhạc bằng mô tả "căng thẳng, chậm, piano" trả về bài phù hợp trong top 3 (đánh giá thủ công trên kho 50 bài).
- **AC-M2-05:** `channel.validate` bắt được hồ sơ thiếu file tham chiếu (LUT, giọng).
- **AC-M2-06:** Một video thật của một kênh được đăng lên YouTube từ file phát hành.

### M3
- **AC-M3-01:** Chỉnh vị trí/kích thước/timing trong Studio → lưu → mở lại vẫn còn; agent sinh lại frame khác không đè frame đã chỉnh.
- **AC-M3-02:** Sửa mã tự do trong Studio (nếu lọt được) → `studio.commit` từ chối kèm giải thích.
- **AC-M3-03:** Đổi timing caption trong bảng caption → render phản ánh đúng.
- **AC-M3-04:** Báo cáo chi phí token/API theo video khớp log trace.

### M4, M5
- **AC-M4-01:** Shorts 9:16 ≤ 60 giây từ một video dài, đúng vùng an toàn.
- **AC-M5-01:** Phim ngắn 3–5 phút, 3 nhân vật + người dẫn, phụ đề theo người nói; miệng nhân vật khớp nhịp ở shot trung/cận (M5b).

## 11. Giả định và rủi ro sản phẩm

| Giả định | Kiểm ở | Nếu sai |
|---|---|---|
| OmniVoice clone tiếng Việt/Đức đủ tự nhiên | S1 | Dùng Vbee cho tiếng Việt; tìm engine khác cho tiếng Đức |
| Qwen-Image-2.1 sửa ảnh và tạo ảnh trong suốt ổn định | S2 | Giảm FR-IM-03, dùng `remove-background` |
| Workflow HyperFrames chạy được khi thay TTS và bỏ bước sinh ảnh | S3 | Fork sâu hơn, tăng chi phí M1 |
| HyperFrames/Studio giữ thuộc tính `data-sf-*` | S3, S6 | Dùng `id` tiền tố `sf-` hoặc bảng ánh xạ |
| Studio cho phép lọc diff theo thuộc tính | S6 | Nhận cả frame khi lưu, dựa vào việc ẩn trình sửa mã |
| Gói Claude dùng được với Agent SDK lâu dài | — | Chuyển sang API key (đã có port) |

## 12. Câu hỏi mở

Không có câu hỏi mở chặn M0–M1. Các ngưỡng đánh dấu `[chờ Sx]` được chốt trong báo cáo spike (D2).

## 13. Truy vết

| Nhóm FR | Mục kiến trúc | Spec |
|---|---|---|
| WS, OB-02 | 4, 5, 14 | D3 |
| VO, IM, OP, RD | 6, 7 | D4 |
| CH-05/06, OP-07 | 11 | D5 |
| WF, SC, CP | 8, 9 | D6, feature-notes |
| MU | 7.3 | D8 |
| ST | 10 | D9 |
| CH-02/04, WS-02 | 3, 10 | D10 |
| OB | 12 | D11 |
| NFR-09, NFR-10 | 12, 13 | D12 |
