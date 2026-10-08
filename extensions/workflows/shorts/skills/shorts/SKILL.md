---
name: shorts
description: Hướng dẫn từng bước của workflow StudioFlow "shorts" (video dọc ≤ 60 giây, Hook → Insight → Paradox; mới hoặc cắt từ video dài). Dùng khi engine giao bước storyboard, assets, look, effects, overlays hoặc music của workflow này.
---

# Workflow shorts (video dọc ≤ 60 giây)

Engine giao cho bạn từng bước bằng chỉ dẫn "Thực hiện bước <id> của workflow shorts theo skill…". Chỉ làm đúng bước đó, ghi file bằng `artifact.write`, rồi gọi `workflow.step_complete` với `step_id` của bước và `outputs` là các file đã ghi. Không tự chạy bước khác.

Các bước engine tự làm: design-system, script (refine-loop, rubric shorts), voice, frames (phiên frame dựng khung dọc 1080×1920), captions (karaoke lớn giữa màn hình), finalize (kiểm ≤ 60 giây và chữ trong vùng an toàn), meta (tiêu đề ≤ 60 ký tự, `#shorts`), render.

**Cắt từ video dài:** khi `BRIEF.md` có `source_video_id`, kịch bản đã dùng lại nguyên văn các line của video nguồn (audio dùng lại). Bạn đọc được video nguồn bằng `artifact.read` với tiền tố `video:<vd_…>/` (ví dụ `video:vd_…/STORYBOARD.md`) để giữ cùng hình ảnh/asset, nhưng **dựng lại bố cục dọc** — không chép nguyên frame ngang.

## Bước `storyboard` → `STORYBOARD.md`

Định dạng như mọi workflow (front matter; `## Scene …` + `sf-scene`; `### Frame …` + `sf-frame` với `beat_ids`, `line_ids`, `intent`, `layers`, `transition_in`). Quy tắc riêng:
- **Một scene.** Mỗi line thuộc đúng một frame; frame **2–5 giây** (thường 1 line/frame, line dài tách theo ý).
- Frame đầu là **hook**: chữ lớn (≤ 5 từ) hoặc con số, xuất hiện ngay trong 0,5 giây.
- Chữ trên hình **lớn và ít** (≤ 6 từ), đặt ở **nửa trên** khung (caption karaoke chiếm dải giữa); mọi chữ trong vùng an toàn dọc (chừa lề phải cho nút của YouTube, chừa 20% dưới).
- Kiểu frame gợi ý: `big-text` (một câu chữ lớn), `stat-pop` (con số bật lên), `split-reveal` (hai nửa đối lập — hợp với paradox). Ghi kiểu vào `intent`.
- `transition_in`: cắt thẳng hoặc `push-slide`/`zoom-through` 200–300 ms; không transition chậm.
- **Không ghi `id:`** cho scene/frame/layer mới.
- Ghi `STORYBOARD.md`, đọc lại (ID đã gán), rồi `workflow.step_complete {step_id: "storyboard", outputs: ["STORYBOARD.md"]}`.

## Bước `assets` (khi engine giao)

Ưu tiên ảnh đã có (thư viện kênh, hoặc asset của video nguồn qua `asset.search`); ảnh sinh theo khung dọc (`asset_request: { source: generate, prompt: "…", aspect: "9:16" }`), tối đa 3 ảnh. Ghi `STORYBOARD.md` (giữ mọi `id`) rồi `workflow.step_complete {step_id: "assets", outputs: ["STORYBOARD.md"]}` (không đổi gì → `outputs: []`).

## Bước `music`

> 085: engine tự chạy bước này (không giao agent) khi tính năng nâng cao **Nhạc nền** (`advanced.music`) bật; tắt thì bỏ qua. Phần dưới chỉ dùng khi người dùng nhờ chọn/đổi nhạc qua chat. Ở bước storyboard vẫn ghi `music: { query: … }` (mô tả nhạc) cho mỗi scene.

Nhạc có nhịp rõ, năng lượng cao, ngắn. `music.find` với query tiếng Anh (`min_duration_ms` ≈ thời lượng short). Có kết quả → `music: { track_id: mt_… }`. Không có (`E_MUSIC_NOT_FOUND`) là bình thường: thử lại một lần; vẫn không có → `music: none`, vẫn ghi `STORYBOARD.md` và `workflow.step_complete {step_id: "music", outputs: ["STORYBOARD.md"]}`.
## Bước `finish` (M3, 062)

Engine giao **một phiên** cho cả ba phần hoàn thiện hình, kèm danh mục look, hiệu ứng, khối overlay, ngân sách hiệu ứng nặng và hiện trạng từng frame. Làm lần lượt theo ba mục dưới — look (mục "Bước `look`"), hiệu ứng (mục "Bước `effects`"), overlay (mục "Bước `overlays`"); phần nào không cần thì bỏ qua. Ghi `STORYBOARD.md` (giữ mọi `id`) rồi gọi **một lần** `workflow.step_complete {step_id: "finish", outputs: ["STORYBOARD.md"]}` (bỏ qua lời dặn `step_complete` riêng trong từng mục).

## Bước `look` (M3)

Chỉ dẫn của engine có danh mục look (gói phong cách + biến thể) và look hiện tại của từng frame. Look kênh là `{{config:look.id}}`. Mặc định giữ look kênh; chỉ đặt `look` cho scene khi không khí khác rõ (đêm, hồi tưởng, tư liệu cũ): ghi `look: <biến thể>` (ví dụ `night`) hoặc `look: <gói khác>` vào `sf-scene`; ngoại lệ một frame thì `config: { look.id: … }` trong `sf-frame`. Muốn so sánh trước: `grade.compare {asset_ids: [ảnh tiêu biểu], looks: [...]}` rồi xem `contact_sheet`. Look được nướng vào ảnh khi dựng frame (chữ/hình HTML không đổi màu). Không có gì cần đổi → không ghi file. Xong: `workflow.step_complete {step_id: "look", outputs: ["STORYBOARD.md"]}`.

## Bước `effects` (M3)

Hiệu ứng media dùng tiết chế, phục vụ nội dung (hồi tưởng → `grain`, tư liệu cũ → `filmArtifacts`, nhấn mạnh → `bloom`). Hiệu ứng `[nặng]` làm render chậm: tôn trọng ngân sách trong chỉ dẫn (2 mỗi phút video). Với mỗi ảnh cần hiệu ứng: `media.treatment {asset_id, effect, mode: "dry_run"}` → đọc kết quả (`within_budget`, frame bị ảnh hưởng) → nếu ổn thì `mode: "apply"` (app ghi `sf-frame.effects`, người dùng được hỏi vì storyboard đã duyệt). Mức tùy chọn: `grain:0.3`. Không cần hiệu ứng → không làm gì. Xong: `workflow.step_complete {step_id: "effects", outputs: ["STORYBOARD.md"]}`.

## Bước `overlays` (M3)

Đề xuất overlay theo quy tắc kênh `{{config:overlay.rules}}` (ví dụ lower third khi nhân vật/địa danh xuất hiện lần đầu, nhãn địa điểm khi đổi bối cảnh). Ghi vào `sf-frame`: `overlays: [{ block: lower-third, vars: { title: "…", subtitle: "…" } }]` — chỉ dùng khối trong danh mục, đủ biến bắt buộc (dấu `*`), chữ ngắn (≤ 40 ký tự). Thẻ mô phỏng nền tảng thật (bình luận, bài đăng mạng xã hội) chỉ dùng với nội dung có thật. Mỗi frame tối đa một overlay; shorts thường không cần overlay (chữ lớn đã đủ). Ghi bằng `artifact.write` (giữ mọi `id`), rồi `workflow.step_complete {step_id: "overlays", outputs: ["STORYBOARD.md"]}`.
