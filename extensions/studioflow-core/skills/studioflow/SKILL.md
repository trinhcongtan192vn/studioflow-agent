---
name: studioflow
description: Quy tắc làm việc với dự án video StudioFlow — artifact, ID, đường dẫn và công cụ sf. Dùng khi đọc/ghi SCRIPT.md, STORYBOARD.md, BRIEF.md hoặc chạy lệnh trong video.
---

# StudioFlow — quy tắc miền

- Mỗi kênh là một thư mục; mỗi video là `videos/<vd_…>/`. Đường dẫn trong công cụ `sf` là **tương đối thư mục video** (ví dụ `SCRIPT.md`, `audio/lines/ln_….wav`).
- **Chat kênh (chưa ở video nào) mà người dùng muốn làm một video** (dựng video/short từ link, chủ đề…): gọi `video.create {title, instruction}` — `instruction` là yêu cầu đầy đủ của người dùng (link, dạng video, thời lượng…). App tự mở video đó và agent của video làm tiếp. Không bảo người dùng tự tạo video hay "mở phiên chat trong video"; gọi xong thì báo ngắn rồi dừng.
- Đọc bằng `mcp__sf__artifact_read`, ghi bằng `mcp__sf__artifact_write` (gửi toàn bộ nội dung file). Muốn chắc file không bị đổi giữa chừng, truyền `base_hash` lấy từ lần đọc.
- `SCRIPT.md`: mỗi beat là heading `##` có marker `<!-- sf:beat id=bt_… -->`; mỗi line là marker `<!-- sf:line id=ln_… speaker=… -->` + đoạn văn ngay sau. Line/beat mới **không cần ID** — Gateway gán khi ghi. Giữ nguyên ID khi sửa chữ.
- `STORYBOARD.md`: khối ```` ```sf-scene ```` và ```` ```sf-frame ```` (YAML). Mỗi line thuộc đúng một frame.
- Không sửa `.sf/` (dữ liệu dẫn xuất). Không xóa file — không có công cụ xóa.
- Kiểm tra trước khi ghi bằng `mcp__sf__artifact_validate {path, content}`; lỗi có đường dẫn trường.
- Giá trị cấu hình (look, giọng, caption…) lấy bằng `mcp__sf__config_resolve`, không đoán.

## Giọng đọc

- Người dẫn dùng `voice.id` của kênh/video; nhân vật dùng `voice_id` trong `CAST.md`.
- **Luôn xem cái đã có trước** (035):
  - `voice.list`: giọng của kênh, `used_by` (ai đang dùng), `suggested_for`, `ready`, và `narrator_voice_id`;
  - `cast.list`: nhân vật cấp kênh kèm giọng.
  Nhân vật đã có ở kênh thì dùng lại **đúng id `ca_…`** trong CAST.md: giọng, ảnh chuẩn, biểu cảm tự theo, không cần hỏi lại. Giọng sẵn có hợp với nhân vật mới thì đưa vào danh sách cho người dùng chọn trước khi tạo giọng mới. Đã có `narrator_voice_id` thì người dẫn dùng giọng đó.
- **Có file giọng mẫu** (người dùng đính kèm `uploads/…`, giọng họ được phép dùng): `voice.profile_create {name, ref_audio, language}`.
- **Chưa có file mẫu và không có giọng sẵn phù hợp** (033): gợi ý **2–3 giọng khác nhau** cho mỗi người nói thiếu giọng, mỗi giọng một lần `voice.design {name, gender, age, pitch, for}`.
  - Chọn thuộc tính theo nội dung: kênh trầm hoặc lịch sử → giọng trầm, trung niên; kênh trẻ → thanh niên, cao độ vừa; nhân vật → theo tuổi, giới tính, tính cách trong `STORY.md`/`CAST.md`.
  - Các phương án phải khác nhau rõ (tuổi, cao độ, hoặc `seed` khác). `for` là `narrator` hoặc `ca_…`.
  - Đặt `name` dễ hiểu, ví dụ "Nam trung niên, trầm".
  - `accent` chỉ dùng cho kênh tiếng Anh.
  - Chờ job (`job.wait`). App tự hiện thẻ nghe thử trong chat. Tóm tắt các phương án rồi để người dùng bấm **Chọn giọng này**. **Không tự chọn thay.**
- Người dùng chọn giọng `vo_…`:
  - Người dẫn: `config.set {key: "voice.id", value: "vo_…", tier: "channel"}`. Nếu người dùng chỉ muốn đổi cho video này, dùng `tier: "video"`.
  - Nhân vật: ghi `voice_id: vo_…` vào khối `sf-cast` của nhân vật đó trong `CAST.md`.
  - Bước Giọng đọc đang lỗi → `workflow.run_to {step_id: "voice"}` hoặc nhắc người dùng bấm **Chạy lại bước**.

## Tự duyệt bước (mặc định, 034)

(Khác **Autopilot** của kênh — chế độ tự hành M6: kênh bật Autopilot thì Tự duyệt bước luôn bật.)

Kiểm bằng `mcp__sf__config_resolve {key: "workflow.autopilot"}`. Khi bật, **bạn là người điều phối**:
- **Tự quyết** mọi lựa chọn trong bước:
  - bố cục, chọn ảnh/sinh ảnh, look, hiệu ứng, overlay, nhạc;
  - số scene/frame, chia line, cách sửa khi gate báo lỗi.
  Không hỏi người dùng "bạn muốn A hay B?". Chọn phương án hợp brief và hồ sơ kênh, ghi lý do ngắn trong tóm tắt bước.
- **Chỉ dừng** ở điểm chốt (`workflow.key_approvals`, mặc định truyện `story`, kịch bản `script`, bản nháp `finalize`), ở brief, và khi **chọn giọng** cho người nói chưa có giọng (gợi ý bằng `voice.design`, chờ người dùng chọn).
- Điểm duyệt khác (storyboard, animatic, dàn nhân vật…) app tự duyệt. Đừng nhắc người dùng duyệt chúng.
- Gặp lỗi có thể tự sửa (gate, lint, thiếu asset): tự sửa và chạy tiếp. Chỉ báo người dùng khi cần quyết định thuộc điểm chốt hoặc cần tài nguyên họ phải cung cấp (file, khóa API, tiền).
- Người dùng muốn duyệt từng bước: `config.set {key: "workflow.autopilot", value: false, tier: "video"}` (hoặc `tier: "channel"` cho cả kênh).

## Bước bị lỗi (036)

- Lỗi do file sai (gate `artifact_valid`, `speakers_voiced`…): sửa đúng file của bước bằng `artifact.write`, rồi gọi **`workflow.recheck {step_id}`**. App kiểm lại trên file hiện có; qua thì workflow chạy tiếp.
- **Không** dùng `workflow.rewind` hay chạy lại bước để "đẩy" bước đã sửa: chạy lại sẽ sinh lại và viết đè file. `workflow.run_to` cũng báo lỗi khi còn bước lỗi phía trước.
- Cảnh báo thời lượng (`E_GATE_WARNING`, objective `audio_duration`: audio thật lệch thời lượng mục tiêu) không phải lỗi hỏng: báo người dùng thời lượng thật và hỏi giữ nguyên hay sửa. Người dùng đồng ý giữ → **`workflow.waive {step_id, check: "audio_duration"}`**; muốn đúng thời lượng → sửa beat lệch trong SCRIPT.md rồi chạy lại bước (chỉ line đổi được sinh lại). Không tự bỏ qua khi người dùng chưa đồng ý.
- Kịch bản thoại: người nói chỉ được là `narrator` hoặc id `ca_…` có trong `CAST.md` hay nhân vật cấp kênh (`cast.list`). Không tự đặt id mới.

## Brief (pha briefing, 040)

- Viết nội dung brief vào `BRIEF.md`, rồi gọi **`workflow.select {workflow_id, output_profile}`** để chọn workflow. Lệnh này ghi đề xuất vào brief và **tạo điểm duyệt brief**, thẻ Duyệt sẽ hiện ở cuối khung chat. (Ghi thẳng `proposed_workflow` vào BRIEF.md thì app cũng tự tạo điểm duyệt, nhưng nên dùng `workflow.select`.)
- Nhắc người dùng bấm **Duyệt** trên thẻ. Không tự duyệt thay.

## Tạo video từ video YouTube tham khảo (044)

Người dùng gửi URL YouTube và nhờ làm video tương tự / hay hơn. Mục tiêu: **học công thức tạo nội dung hấp dẫn, không sao chép nội dung**.

1. `youtube.video {url}` (tiêu đề, kênh, thời lượng, lượt xem…) và `youtube.transcript {url}` (lời thoại có mốc `[m:ss]`). Không có transcript → phân tích từ tiêu đề, mô tả, tags và nói rõ với người dùng. Lỗi thiếu khóa API → nhắc người dùng thêm khóa YouTube trong Cài đặt.
2. Phân tích, tập trung vào **"why it works"** và **"how to reproduce the mechanism"**; không viết lại hay diễn đạt lại video. Ghi `REFERENCE.md` của video (`artifact.write`):

   ```markdown
   # Phân tích video tham khảo
   Nguồn: <tiêu đề> — <kênh> (<url>), <thời lượng>, <lượt xem>

   ## Core idea
   Video thực sự nói về gì?
   ## Audience & promise
   Video hứa hẹn điều gì với người xem?
   ## Hook
   Điều gì khiến người xem muốn xem tiếp (kèm mốc thời gian)?
   ## Structure
   Cấu trúc và flow của video (các phần, mốc thời gian, nhịp).
   ## Retention drivers
   Yếu tố giữ chân người xem: curiosity, conflict, surprise, storytelling, information gap…
   ## Winning formula
   Cô đọng thành một công thức áp dụng được cho video khác.
   ## Adaptation
   3 cách áp dụng công thức cho chủ đề mới, không sao chép nội dung gốc (mỗi cách: chủ đề, angle, hook mở đầu).
   ## Best angle
   Angle hấp dẫn nhất và vì sao (ngắn gọn).
   ```

3. Tóm tắt trong chat (công thức + best angle, 4–6 dòng). Người dùng đã nêu chủ đề mới → áp công thức vào chủ đề đó.
4. Lên brief như bình thường từ best angle: chọn workflow hợp với dạng video (giải thích, truyện, shorts…) và thời lượng, viết `BRIEF.md` với mục **Công thức tham khảo** (Winning formula, Best angle, hook mở đầu và cấu trúc dự kiến — tóm từ `REFERENCE.md`, kèm URL nguồn), rồi `workflow.select` → thẻ duyệt brief. Các bước sau (design system, kịch bản…) đọc `BRIEF.md` nên giữ được công thức; nội dung, ví dụ và câu chữ phải là của kênh, không lấy từ video gốc.

Nghiên cứu thêm (chủ đề đang hot, video đối thủ): `youtube.search {query, order: "viewCount", published_after}` và `youtube.channel_videos {channel_id}`.

Người dùng hỏi "hôm nay nên làm chủ đề gì" → `research.get` (lần quét gần nhất: chủ đề ứng viên của đối thủ, trending, Google Trends, tin nóng, điểm cao trước kèm lý do); chưa có hoặc cũ → `research.scan` (job, ghi `research/<ngày>.json`) rồi `job.wait` và `research.get`. Nêu 3–5 chủ đề kèm lý do; nguồn lỗi trong `sources` (ví dụ thiếu khóa YouTube) thì nói rõ.

Kế hoạch ngày Autopilot: "hôm nay kênh làm gì, đăng lúc nào" → `autopilot.plan_get` (chủ đề, góc nhìn, workflow, giờ đăng, lý do, trạng thái từng mục; `notes` nói vì sao ít/không có video). Chưa có hoặc muốn lập lại → `autopilot.plan_run` (job; dùng nghiên cứu hôm nay, chưa có thì quét; giữ mục đã có), rồi `job.wait` và `autopilot.plan_get`. Người dùng muốn bỏ/đổi một mục → `autopilot.plan_update {date, item_id, patch}` (bỏ qua/khôi phục, tiêu đề, góc nhìn, workflow, giờ đăng); mục đang/đã làm không sửa được.

Autopilot tự làm video theo kế hoạch ngày (052): "Autopilot đang làm gì / vì sao video này dừng" → `autopilot.status` (trạng thái, mục hôm nay: `in_production` đang làm, `produced` xong, `failed` hỏng, `needs_review` **đỗ chờ người** — `note` nêu lý do như điểm kịch bản thấp hơn ngưỡng, thiếu giọng đọc, cần xác nhận chi phí; kèm 20 dòng nhật ký vận hành). Video đỗ: mở video đó, xem điểm duyệt đang chờ và sửa/duyệt bằng tay như video thường. Khi được giao brief bởi Autopilot (tin nhắn bắt đầu `[Autopilot]`) không có người xem: tự quyết, không hỏi lại, ghi `REFERENCE.md` + `BRIEF.md` rồi `workflow.select` đúng workflow/dạng xuất đã nêu.

Đăng bài (053): video Autopilot đã làm xong được app tự tải lên YouTube riêng tư (kèm giờ công khai khi dự án API đã kiểm duyệt; chưa kiểm duyệt thì người dùng tự công khai trong YouTube Studio) và gửi bản xem trước vào Telegram. Hỏi "đã đăng chưa / vì sao chưa" → `publish.status` (pending: chưa kết nối YouTube; scheduled: hẹn giờ; private: chờ công khai thủ công; failed: kèm lỗi). Chỉ khi người dùng yêu cầu rõ mới dùng `publish.cancel` (hủy đăng, video ở lại riêng tư) hoặc `publish.now` (đăng ngay).
