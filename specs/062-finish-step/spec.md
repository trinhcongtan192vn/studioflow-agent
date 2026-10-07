# 062 — Gộp Look màu + Hiệu ứng + Overlay thành một bước "Hoàn thiện hình"

## Vấn đề
Ba bước agent riêng (`look` trước dựng frame, `effects`/`overlays` sau) cùng sửa STORYBOARD.md từ hồ sơ kênh → ba phiên agent (thời gian + token Claude) cho việc có thể làm một lần.

## Yêu cầu
- FR-WF-62-01: Bước thư viện mới `finish` (D6): agent, đọc hồ sơ kênh, ghi `sf-scene.look`, `sf-frame.effects/overlays`; gate `look_valid` + `effects_valid` + `overlays_valid`. Chỉ dẫn của engine gồm cả ba danh mục, ngân sách hiệu ứng nặng, hiện trạng từng frame.
- FR-WF-62-02: Năm workflow (narrated-explainer, story-documentary, essay-audiobook, shorts, short-film) thay `look`/`effects`/`overlays` bằng một bước `finish` "Hoàn thiện hình (look, hiệu ứng, overlay)" đặt **sau** dựng frame (look đổi sau khi dựng frame được lớp hoàn thiện nướng lại, không gọi agent dựng lại frame). Skill mỗi workflow có mục "Bước `finish`".
- FR-WF-62-03: Video làm trước: mở lại → `finish` = done nếu `look`/`effects`/`overlays` đã done/skipped (không chạy thêm phiên), ngược lại pending.
- Bước `look`/`effects`/`overlays` vẫn trong thư viện (workflow bên ngoài dùng được).

## AC
- E2E narrated-explainer / essay-audiobook / short-film / story-documentary / shorts xanh với bước gộp (agent chỉ còn `finish`).
- `finish-merge.test.ts`: chuyển trạng thái video cũ.
