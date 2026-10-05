# Kịch bản test thủ công StudioFlow Agent: M0 → M5

Dành cho: người test sản phẩm (Tan). Đi theo thứ tự từ phần 0 đến phần 7. Mỗi bước gồm **Làm** (thao tác) và **Mong đợi** (kết quả đúng). Bước nào sai thì ghi lại vào bảng ở phần 8.

Thời gian ước tính: khoảng 3–4 giờ nếu chạy đủ cả 5 workflow với GPU thật. Phần lớn thời gian là chờ sinh ảnh và render; mỗi workflow có thể test riêng.

---

## 0. Chuẩn bị

| Việc | Ghi chú |
|---|---|
| Đăng nhập Claude Code | Chạy `claude login` một lần. Nếu chưa đăng nhập, Cài đặt sẽ báo "chưa — chạy `claude login`…". |
| GPU NVIDIA và ổ trống ≥ 40 GB | Cần cho giọng (OmniVoice), ảnh (ComfyUI + Qwen-Image) và render. |
| Thư mục kênh test | Ví dụ `D:\SF-Test\kenh-lich-su`. Tạo thư mục **mới, trống**, không nằm trong repo. |
| 2–3 bài nhạc không lời (mp3/wav) | Dùng cho thư viện nhạc (M1/M2). |
| 1 file giọng mẫu 10–20 giây (wav) | Tùy chọn; dùng cho giọng nhân vật ở M5. |

**Mở app:** bấm đúp `Mo-StudioFlow.bat` ở thư mục gốc repo. Lần đầu bat sẽ tự `npm install`, việc này mất vài phút.

**Dữ liệu nằm ở đâu**
- Mọi thứ của một video: `<thư mục kênh>\videos\<vd_…>\` (BRIEF.md, SCRIPT.md, STORYBOARD.md, state.json, chat\, renders\…).
- Video đã render: `videos\<vd_…>\renders\<rn_…>\video.mp4`.
- Model, cache, trace và cài đặt app: `%APPDATA%\StudioFlow Agent` hoặc thư mục `SF_APP_DATA` nếu có đặt.

**Mẹo dùng chung (từ bản này)**
- Mỗi bước workflow xong sẽ có một **thẻ "✓ Xong bước"** trong khung chat, kèm nút như **Xem brief**, **Xem kịch bản**, **Xem storyboard**, **Mở xem trước**, **Xem video**. Không cần đi tìm file trong Explorer.
- Bước bị lỗi sẽ hiện thẻ đỏ có thông báo lỗi và nút **Chạy lại bước**.
- Thẻ **Duyệt** có nút xem từng file cần duyệt, nút **Duyệt** (màu xanh) và ô **Yêu cầu sửa**.
- Tệp `.md` mở ra ở **dạng đọc**:
  - front matter hiện thành chip;
  - lời thoại có nhãn người nói, cảm xúc và chỉ dẫn;
  - cảnh và frame của storyboard hiện thành thẻ.
- Muốn xem nguyên văn, bấm **Xem dạng gốc**.

---

## 1. M0: khởi động, onboarding, kênh

| # | Làm | Mong đợi |
|---|---|---|
| 1.1 | Mở app lần đầu. | Hiện hộp **Thiết lập StudioFlow** (onboarding), liệt kê thành phần còn thiếu và các hồ sơ cài **Tối thiểu / Chuẩn / Đầy đủ**. |
| 1.2 | Chọn **Chuẩn**, bấm cài. | Thanh tiến độ tải model. Đóng app giữa chừng rồi mở lại thì tải tiếp, không tải lại từ đầu. |
| 1.3 | Bấm **Tạo kênh mới**, nhập tên kênh và chọn thư mục kênh test. | Vào **Không gian kênh** gồm 3 cột: Video/Explorer, Chat, các tab bên phải. |
| 1.4 | Về trang chủ (←), mở lại kênh ở mục **Kênh gần đây**. | Kênh mở đúng. |
| 1.5 | Bấm ⚙ **Cài đặt**. | Thấy trạng thái Claude, **Khóa API**, **GPU**, **Dung lượng** (ổ đĩa còn, cache). Có thể dán khóa API (lưu vào Windows Credential Manager, không lưu vào file). |
| 1.6 | Gõ vào chat kênh (chưa chọn video): "Kênh này nói về lịch sử Việt Nam, giọng kể trầm, khán giả 18–35." | Agent trả lời. Có khối "N thao tác" gọn, mở ra xem được từng thao tác. Agent ghi hồ sơ kênh `profile/`. |
| 1.7 | Explorer: mở `profile/` và bấm một tệp. | Hộp xem tệp chỉ đọc mở ra. Explorer không có nút sửa hoặc xóa. |
| 1.8 | **Tạo giọng kênh (bắt buộc trước bước Giọng đọc):** ở chat kênh, bấm 📎 chọn file giọng mẫu 3–10 giây rồi gửi "Tạo giọng đọc cho kênh từ file này, đặt làm giọng mặc định, cho tôi nghe thử." | Agent clone giọng (job `voice.profile`), đặt `voice.id` của kênh, cho nghe thử. Thư mục `voices\vo_…\` có `profile.json` và `voice.pt`. |
| 1.8b | **Không có file mẫu (033):** gửi "Gợi ý cho tôi 3 giọng đọc hợp với kênh." | Ba thẻ 🎙 hiện trong chat. Mỗi thẻ có tên, chip mô tả (ví dụ *Nam · Trung niên · Trầm*), trình nghe câu mẫu và nút **Chọn giọng này**. Bấm chọn một giọng: agent đặt `voice.id`. Ba giọng phải nghe khác nhau rõ. |

---

## 2. M1: Video giải thích có người dẫn (`narrated-explainer`)

| # | Làm | Mong đợi |
|---|---|---|
| 2.1 | Bấm **+ Video mới**, nhập "Lê Lợi và năm 1428", Enter. | Video mới hiện trong danh sách và được chọn; chat của video trống. |
| 2.2 | Chat: "Làm video giải thích 2 phút về việc Lê Lợi lên ngôi năm 1428." | Agent hỏi các câu brief (khán giả, độ dài…), trả lời xong thì có thẻ **Duyệt: Brief** với nút **Xem brief**. |
| 2.3 | Bấm **Xem brief**. | BRIEF.md hiện dạng đọc: chip *Workflow đề xuất: narrated-explainer*, *Thời lượng mục tiêu: 2 phút*… Bấm **Duyệt**. |
| 2.4 | Chờ bước **Design system**. | Thẻ **✓ Xong bước: Design system** kèm nút **Xem design system**. |
| 2.5 | Chờ bước **Kịch bản**. | Thẻ duyệt có nút **Xem kịch bản**: các line có nhãn *Người dẫn*, beat là tiêu đề có vạch xanh, không còn chú thích `<!-- sf:… -->`. |
| 2.6 | Ở thẻ duyệt kịch bản, ghi "Ngắn lại câu mở đầu", bấm **Yêu cầu sửa**. | Agent sửa SCRIPT.md rồi xin duyệt lại; thẻ mới có nội dung đã đổi. Bấm **Duyệt**. |
| 2.7 | Duyệt storyboard bằng **Xem storyboard**. | Mỗi cảnh/frame là một thẻ có *Ý đồ hình* và danh sách *Lớp*. |
| 2.8a | (Nếu bỏ qua 1.8) Bước **Giọng đọc** lỗi. | Thẻ đỏ ghi "Chưa có giọng đọc cho người dẫn…", có nút **✨ Gợi ý giọng** (agent tạo 2–3 giọng để nghe thử và chọn) và nút **📎 Chọn file giọng mẫu**. Chọn file thì lời nhờ agent được soạn sẵn; bấm **Gửi**. Agent tạo giọng rồi chạy lại bước. |
| 2.8 | Bước **Giọng đọc** xong, bấm **Mở xem trước**. | Tab **Xem trước** mở; bảng caption có audio nghe được. Thời lượng được đánh giá trên audio thật, không tính theo số từ/phút. |
| 2.9 | Bước **Nhạc nền**: tab **Nhạc** → **Nạp…** 2–3 bài, rồi để agent chọn. | Nhạc được phân tích (BPM/tag); thẻ bước có nút **Xem nhạc**. |
| 2.10 | Duyệt **Hoàn thiện**, chờ **Tiêu đề và mô tả** và **Render**. | Thẻ **Xem tiêu đề & mô tả** (publish.md: tiêu đề, thẻ, chương). Thẻ render có **Xem video**, phát được ngay trong app. |
| 2.11 | Tab **Tiến độ**. | Mọi bước ✓; bước skip ghi rõ. Có thể **Quay lại bước** / **Chạy tới bước**. |
| 2.12 | Tab **Job**, **Trace**. | Job đã chạy (tts, asr, render…) có thời gian. Trace có `sf.agent.session`. |
| 2.13 | Đóng app, mở lại, chọn video. | Lịch sử chat còn đủ. Nếu đang có duyệt chờ thì thẻ duyệt hiện lại. |

---

## 3. M2: Phim tài liệu kể chuyện có ảnh sinh (`story-documentary`)

| # | Làm | Mong đợi |
|---|---|---|
| 3.1 | Video mới "Trận Bạch Đằng 1288". Chat: "Làm phim tài liệu 3 phút, có ảnh minh họa sinh bằng AI." | Brief đề xuất `story-documentary`. |
| 3.2 | Duyệt brief, kịch bản và storyboard qua các nút CTA. | Storyboard có lớp `background` với *Sinh ảnh: …* (prompt). |
| 3.3 | Bước **Hình ảnh**. | ComfyUI tự khởi động; ảnh sinh dần (tab Job). Trong Explorer, `assets/` có ảnh mới; bấm ảnh để xem trong app. |
| 3.4 | Trong lúc sinh ảnh, xem tab Job. | GPU chạy lần lượt theo pha (giọng → ảnh → render), không chạy chồng gây tràn VRAM. |
| 3.5 | Chat: "Đổi ảnh frame 2 thành cảnh cọc gỗ dưới nước lúc thủy triều rút." | Chỉ frame đó dựng lại. Graph báo nút liên quan *stale* rồi *fresh*. |
| 3.6 | Chat: "Tìm nhạc hùng tráng, trống trận." | Tìm nhạc theo mô tả (CLAP) trả về bài phù hợp trong thư viện. |
| 3.7 | Render. | Video có ảnh, giọng, phụ đề, nhạc nền tự giảm khi có lời (ducking). |
| 3.8 | Cài đặt → **Dung lượng**. | Thấy dung lượng cache/model; dọn cache không xóa file trong kênh. |

---

## 4. M3: Studio, caption, look/hiệu ứng, chi phí

Dùng lại video ở phần 2 hoặc phần 3.

| # | Làm | Mong đợi |
|---|---|---|
| 4.1 | Tab **Xem trước** → **Mở Studio xem trước**. | Studio HyperFrames nhúng trong app, phát được. |
| 4.2 | **Chỉnh trong Studio**: kéo vị trí một chữ, sửa màu; bấm **Lưu thay đổi Studio**. | Thay đổi ghi vào dự án. Frame đó được *ghim* (lần dựng sau không ghi đè, có hỏi giữ/áp lại). |
| 4.3 | Bảng caption dưới khung xem trước: bấm một nhóm, sửa chữ. | Hiện "Đã lưu caption."; `caption-overrides.json` có bản sửa; audio nhóm phát đúng đoạn. |
| 4.4 | Trong Studio dừng ở một mốc, bấm **Đính kèm mốc hiện tại**, rồi chat "Chỗ này chữ hơi nhỏ". | Chip *Mốc x.xx s* hiện trên ô chat; agent biết đang nói frame nào. |
| 4.5 | Chat: "Đổi look sang vintage-film, thêm hiệu ứng hạt phim cảnh 1, thêm overlay lower-third tên nhân vật." | Các bước Look/Hiệu ứng/Overlay chạy; thẻ có **Mở xem trước**. Ảnh đã nướng look, không còn grading lúc chạy. |
| 4.6 | Tab **Chi phí**. | Có **Tổng**, token vào/ra và chi phí theo bước; **Xuất CSV** được. |
| 4.7 | Cài đặt → bật Phoenix. | Mở được giao diện Phoenix cục bộ để xem trace chi tiết. |
| 4.8 | Sửa tay SCRIPT.md bằng Notepad ngoài app. | Thanh đỏ "File bị sửa ngoài app…"; app không tự ghi đè. |

---

## 5. M4: Essay/audiobook và Shorts

| # | Làm | Mong đợi |
|---|---|---|
| 5.1 | Video mới. Chat: "Làm bản đọc sách/essay 5 phút về tinh thần Bình Ngô đại cáo, hình tĩnh, nhịp chậm." | Brief chọn `essay-audiobook`. Caption tĩnh, nghỉ giữa câu dài hơn (cấu hình mặc định của workflow). |
| 5.2 | Chạy tới render và xem video. | Hình chuyển chậm, nhạc nhỏ, đọc rõ. |
| 5.3 | Video mới. Chat: "Cắt một Shorts 45 giây từ video Lê Lợi và năm 1428." | Brief chọn `shorts`, có *Video nguồn* = video phần 2, định dạng 1080×1920. |
| 5.4 | Duyệt storyboard và chạy tới render. | Video dọc; phụ đề karaoke trong vùng an toàn (không bị UI YouTube che); tiêu đề ≤ 60 ký tự. |

---

## 6. M5: Phim ngắn nhiều nhân vật và lip-sync (`short-film`)

| # | Làm | Mong đợi |
|---|---|---|
| 6.1 | Video mới "Cậu bé và con trâu". Chat: "Làm phim ngắn 3 phút, 2 nhân vật: cậu bé Tí (lém lỉnh) và ông nội (hiền), có người dẫn truyện, phong cách 2D phẳng." | Brief chọn `short-film`; agent hỏi thêm về giọng mẫu. |
| 6.2 | Duyệt **Truyện** bằng **Xem truyện**. | STORY.md có các thẻ *Đoạn truyện*: tóm tắt, nhân vật, bối cảnh, diễn biến. |
| 6.3 | Duyệt **Dàn nhân vật** bằng **Xem nhân vật**. Không có giọng mẫu thì nhờ "gợi ý giọng cho từng nhân vật". | Mỗi nhân vật có 2 thẻ 🎙 "· cho ca_…" hợp tuổi và tính cách (Tí: trẻ em, cao; ông nội: cao tuổi, trầm). Chọn từng giọng; CAST.md có `voice_id`. Có thể đính kèm 📎 file giọng mẫu thay thế. |
| 6.4 | Duyệt kịch bản. | Line có nhãn người nói khác nhau (`ca_…`), cảm xúc và chỉ dẫn (ví dụ *giọng run*). |
| 6.5 | Bước **Giọng nhân vật** xong. | Mỗi nhân vật một giọng khác nhau; giọng biểu cảm lưu trong `characters/<ca>/emotions/`. |
| 6.6 | Duyệt **Animatic** (bấm **Mở xem trước** để xem). | Animatic thô có giọng và hình tĩnh, duyệt nhịp trước khi dựng. |
| 6.7 | Chat: "Bật lip-sync." rồi "Chạy tiếp." | Bước **Khẩu hình** chạy (trước đó bị skip vì `lipsync.enabled` mặc định là tắt); miệng nhân vật mở/đóng theo tiếng. |
| 6.8 | Render, bấm **Xem video**. | Phụ đề đổi màu theo người nói; miệng khớp tương đối với lời; có nhạc nền. |

---

## 7. Kiểm tra lỗi và phục hồi

| # | Làm | Mong đợi |
|---|---|---|
| 7.1 | Trong lúc đang sinh ảnh, đóng hẳn app rồi mở lại. | Workflow tiếp tục từ bước dở; job dở chạy lại, job xong không chạy lại (cache). |
| 7.2 | Tắt mạng rồi gửi chat. | Thông báo lỗi đọc được; app không treo. |
| 7.3 | Khi một bước lỗi, bấm **Chạy lại bước** trên thẻ đỏ. | Bước chạy lại; xong thì có thẻ ✓. |
| 7.4 | Esc khi agent đang trả lời. | Agent dừng. |

---

## 8. Ghi kết quả

| Mục | Đạt / Lỗi | Ghi chú (ảnh chụp, video id, thời điểm) |
|---|---|---|
| 1.x | | |
| 2.x | | |
| 3.x | | |
| 4.x | | |
| 5.x | | |
| 6.x | | |
| 7.x | | |

Khi báo lỗi, gửi kèm:
- `videos\<vd>\state.json`;
- phần chat liên quan;
- tab **Trace** (hoặc Phoenix) của lần chạy lỗi.
