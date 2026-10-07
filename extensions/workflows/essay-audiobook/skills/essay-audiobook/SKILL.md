---
name: essay-audiobook
description: Hướng dẫn từng bước của workflow StudioFlow "essay-audiobook" (tiểu luận / sách nói nhịp chậm). Dùng khi engine giao bước storyboard, assets, look, effects, overlays hoặc music của workflow này.
---

# Workflow essay-audiobook (tiểu luận / sách nói)

Engine giao cho bạn từng bước bằng chỉ dẫn "Thực hiện bước <id> của workflow essay-audiobook theo skill…". Chỉ làm đúng bước đó, ghi file bằng `artifact.write`, rồi gọi `workflow.step_complete` với `step_id` của bước và `outputs` là các file đã ghi. Không tự chạy bước khác.

Các bước engine tự làm (bạn không làm): design-system, script (refine-loop), voice (TTS + ASR), frames (phiên frame riêng), captions, finalize, meta (có chương theo beat), render.

Tinh thần: **nhịp chậm, hình tối giản, chữ ít mà đắt**. Người xem chủ yếu nghe; hình giữ không khí và làm nổi trích dẫn, tên chương. Mỗi beat của SCRIPT.md là một **chương** (1–3 phút). Caption tĩnh, cụm dài (cấu hình của workflow) — không cần nhắc trong storyboard.

## Bước `storyboard` → `STORYBOARD.md`

Đọc `BRIEF.md`, `SCRIPT.md` (line `ln_…`, beat `bt_…`) và `frame.md`. Định dạng như mọi workflow (front matter `schema_version: 1`, `video_id`, `status: draft`; `## Scene …` + khối `sf-scene`; `### Frame …` + khối `sf-frame` với `beat_ids`, `line_ids`, `intent`, `layers`, `transition_in`).

Quy tắc riêng:
- **Mỗi line thuộc đúng một frame**, theo thứ tự kịch bản. Một frame cho **15–30 giây** lời đọc (gộp nhiều line liên tiếp); không cắt vụn.
- **Mỗi chương (beat) mở bằng một frame tiêu đề chương**: layer `text` là tên chương (ngắn, ≤ 8 từ), nền tĩnh hoặc chuyển động rất chậm; frame này vẫn chứa các line đầu của beat.
- **Trích dẫn**: khi line đọc một trích dẫn, frame đó đặt trích dẫn nổi bật — layer `text` gồm câu trích (rút gọn ≤ 25 từ nếu dài) và layer `text` thứ hai là `— Tác giả, Tác phẩm`. Không bịa trích dẫn; chỉ dùng câu có trong SCRIPT.md.
- Hình còn lại tối giản: nền màu/chất liệu (`background` với `notes`), hình trừu tượng lặp chậm (`shape`, `notes: "abstract loop, chậm"`), hoặc một ảnh có **chuyển động pan/zoom rất chậm** (intent ghi rõ "slow pan").
- `transition_in`: frame đầu bỏ trống; trong chương `crossfade` 800–1200 ms; sang chương mới `blur-crossfade` 1000 ms. Không dùng transition nhanh.
- Thường **một scene**; tách scene khi tác phẩm/chủ đề đổi hẳn (để nhạc đổi theo).
- **Không ghi `id:`** cho scene/frame/layer mới — app tự gán.
- Ghi bằng `artifact.write` (`path: STORYBOARD.md`), đọc lại (ID đã gán), rồi `workflow.step_complete {step_id: "storyboard", outputs: ["STORYBOARD.md"]}`.

## Bước `assets` (khi engine giao)

Ưu tiên thư viện kênh (`asset.search`) và hình vẽ bằng code. Ảnh sinh (`asset_request: { source: generate, prompt: "…" }`, prompt tiếng Anh, tĩnh lặng, tối giản) **tối đa một ảnh mỗi chương**, dùng cho frame tiêu đề chương hoặc frame trích dẫn quan trọng. Layer không có ảnh phù hợp → đổi sang `shape`/`background` với `notes`. Ghi `STORYBOARD.md` (giữ mọi `id`) rồi `workflow.step_complete {step_id: "assets", outputs: ["STORYBOARD.md"]}` (không đổi gì → `outputs: []`).

## Bước `music`

Nhạc nền nhẹ, không lời, nhịp chậm (piano, ambient, đàn dây). Với mỗi scene: `music.find` với query tiếng Anh từ không khí bài. Có kết quả → `music: { track_id: mt_… }` (không đặt `volume_db`: workflow dùng mức nền thấp của nó). Không có kết quả (`E_MUSIC_NOT_FOUND`, kể cả kho trống) là bình thường: thử lại một lần ít bộ lọc hơn; vẫn không có → `music: none`, vẫn ghi `STORYBOARD.md` và gọi `workflow.step_complete {step_id: "music", outputs: ["STORYBOARD.md"]}` — không bịa `track_id`.
## Bước `finish` (M3, 062)

Engine giao **một phiên** cho cả ba phần hoàn thiện hình, kèm danh mục look, hiệu ứng, khối overlay, ngân sách hiệu ứng nặng và hiện trạng từng frame. Làm lần lượt theo ba mục dưới — look (mục "Bước `look`"), hiệu ứng (mục "Bước `effects`"), overlay (mục "Bước `overlays`"); phần nào không cần thì bỏ qua. Ghi `STORYBOARD.md` (giữ mọi `id`) rồi gọi **một lần** `workflow.step_complete {step_id: "finish", outputs: ["STORYBOARD.md"]}` (bỏ qua lời dặn `step_complete` riêng trong từng mục).

## Bước `look` (M3)

Chỉ dẫn của engine có danh mục look (gói phong cách + biến thể) và look hiện tại của từng frame. Look kênh là `{{config:look.id}}`. Mặc định giữ look kênh; chỉ đặt `look` cho scene khi không khí khác rõ (đêm, hồi tưởng, tư liệu cũ): ghi `look: <biến thể>` (ví dụ `night`) hoặc `look: <gói khác>` vào `sf-scene`; ngoại lệ một frame thì `config: { look.id: … }` trong `sf-frame`. Muốn so sánh trước: `grade.compare {asset_ids: [ảnh tiêu biểu], looks: [...]}` rồi xem `contact_sheet`. Look được nướng vào ảnh khi dựng frame (chữ/hình HTML không đổi màu). Không có gì cần đổi → không ghi file. Xong: `workflow.step_complete {step_id: "look", outputs: ["STORYBOARD.md"]}`.

## Bước `effects` (M3)

Hiệu ứng media dùng tiết chế, phục vụ nội dung (hồi tưởng → `grain`, tư liệu cũ → `filmArtifacts`, nhấn mạnh → `bloom`). Hiệu ứng `[nặng]` làm render chậm: tôn trọng ngân sách trong chỉ dẫn (2 mỗi phút video). Với mỗi ảnh cần hiệu ứng: `media.treatment {asset_id, effect, mode: "dry_run"}` → đọc kết quả (`within_budget`, frame bị ảnh hưởng) → nếu ổn thì `mode: "apply"` (app ghi `sf-frame.effects`, người dùng được hỏi vì storyboard đã duyệt). Mức tùy chọn: `grain:0.3`. Không cần hiệu ứng → không làm gì. Xong: `workflow.step_complete {step_id: "effects", outputs: ["STORYBOARD.md"]}`.

## Bước `overlays` (M3)

Đề xuất overlay theo quy tắc kênh `{{config:overlay.rules}}` (ví dụ lower third khi nhân vật/địa danh xuất hiện lần đầu, nhãn địa điểm khi đổi bối cảnh). Ghi vào `sf-frame`: `overlays: [{ block: lower-third, vars: { title: "…", subtitle: "…" } }]` — chỉ dùng khối trong danh mục, đủ biến bắt buộc (dấu `*`), chữ ngắn (≤ 40 ký tự). Thẻ mô phỏng nền tảng thật (bình luận, bài đăng mạng xã hội) chỉ dùng với nội dung có thật. Mỗi frame tối đa một overlay; essay dùng overlay rất tiết chế (thường không cần). Ghi bằng `artifact.write` (giữ mọi `id`), rồi `workflow.step_complete {step_id: "overlays", outputs: ["STORYBOARD.md"]}`.
