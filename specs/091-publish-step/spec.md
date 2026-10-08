# 091 — Bước "Đăng lên nền tảng" sau Render phát hành

## Bối cảnh

Tan: sau bước Render phát hành, thêm bước đăng lên các nền tảng app hỗ trợ; người dùng chọn một hoặc nhiều nền tảng,
đăng cùng lúc; tiêu đề/mô tả cũng được đẩy lên (không chỉ video).

App đã có bộ đăng YouTube (053), TikTok và Facebook Reels (056), nhưng chỉ chạy cho mục kế hoạch Autopilot (hẹn
giờ + cửa sổ phản đối). Video làm tay chưa có đường đăng.

Đã chốt với Tan (MCQ):

- Video làm tay: **đăng ngay**, công khai nếu API cho phép (YouTube/TikTok chưa qua kiểm duyệt API chỉ đăng riêng
  tư được → báo rõ để tự công khai). Không hẹn giờ, không cửa sổ phản đối.
- Chọn nền tảng **ngay trong bước** (thẻ ở tab Tiến độ và trong chat): tích sẵn theo mặc định kênh, bấm "Đăng" mới
  tải lên.
- Video Autopilot: bước tự xong ngay, Autopilot vẫn đăng theo kế hoạch ngày như cũ (053/056).

## Yêu cầu

- FR-PB-91-01 (bước mới, D6 mục 2): `publish` (engine) — đọc bản render phát hành mới nhất, `publish.md`, phụ đề,
  `thumbnail.*`; ghi `publish-state.json` (D3 5.22). Năm workflow cài sẵn thêm bước `publish` ("Đăng lên nền tảng")
  sau `render`. Video cũ chưa có bước này: bước hiện `pending` và chạy khi workflow chạy tiếp.
- FR-PB-91-02 (chờ người dùng chọn): chưa có lựa chọn (`requested_at` null) → bước `failed`
  `E_STEP_INCOMPLETE` với đuôi thông báo `waiting for you to choose where to publish` (cùng cách 083: không phải
  lỗi, giao diện hiện bộ chọn). Video Autopilot (`state.autopilot`) → bước xong ngay, tóm tắt "Autopilot đăng theo
  kế hoạch ngày". Chọn "Không đăng" (danh sách rỗng) → bước xong, không gọi mạng.
- FR-PB-91-03 (tải lên): lần lượt từng nền tảng đã chọn, dùng lại bộ đăng 053/056 ở chế độ `now`: YouTube đã kiểm
  duyệt → công khai ngay (`privacyStatus: public`, không `publishAt`), chưa → riêng tư + ghi chú tự công khai trong
  YouTube Studio; TikTok đã kiểm duyệt → `PUBLIC_TO_EVERYONE` không chờ giờ, chưa → `SELF_ONLY`; Facebook Reels →
  đăng ngay không hẹn giờ (`public`). Tiêu đề, mô tả, thẻ, chương (YouTube), phụ đề và thumbnail (YouTube) đi kèm
  như 053/056; TikTok nhận chú thích = tiêu đề + hashtag từ thẻ (≤ 150 ký tự, cắt ở ranh giới thẻ). Trạng thái từng
  nền tảng ghi vào `publish-state.json` sau mỗi lần đổi (tiến độ bước `n/N`). Nền tảng đã xong (`public`,
  `private`, `scheduled`) cho cùng bản render không tải lại khi bước chạy lại; nền tảng lỗi → bước `failed`
  `E_PROVIDER_FAILED` nêu từng nền tảng, "Chạy lại bước" chỉ thử lại nền tảng lỗi. Chưa kết nối / không phù hợp
  (video ngang lên TikTok/Reels) → không cho chọn ở bộ chọn; nếu vẫn có trong yêu cầu → lỗi nêu lý do.
- FR-PB-91-04 (IPC, D10): `publish.video.options {channel, video}` →
  `{render: {id, output_profile} | null, meta: {title, description, tags}, platforms: [{platform, label, connected,
  eligible, reason?, checked, state?}], requested_at}`; `checked` = nền tảng trong `publish.platforms` của kênh (hoặc
  đã chọn lần trước) mà đã kết nối và phù hợp. `publish.video.start {channel, video, platforms}` → ghi lựa chọn vào
  `publish-state.json` rồi chạy bước `publish` (như `workflow.run_step`); nền tảng lạ → `E_SCHEMA_INVALID`; chưa có
  bản render phát hành → `E_FILE_NOT_FOUND`. Đổi bản render (render lại) → trạng thái cũ bỏ, đăng lại từ đầu.
- FR-UI-91-05: bước `publish` đang chờ chọn → tab Tiến độ hiện thẻ "Đăng lên nền tảng": ô tích từng nền tảng (tình
  trạng kết nối; lý do khi không chọn được; "Kết nối trong Cài đặt kênh"), xem trước tiêu đề + đầu mô tả, nút
  **Đăng** (tắt khi chưa tích) và **Không đăng**. Thẻ chat của bước: "📤 Bước Đăng lên nền tảng đang chờ bạn chọn"
  và nút **Chọn nền tảng** mở tab Tiến độ. Bước xong → thẻ liệt kê kết quả từng nền tảng (link, riêng tư/công khai,
  ghi chú).

## Test

- `packages/core/tests/integration/video-publish.test.ts`: chờ chọn; Autopilot bỏ qua; không đăng; đăng YouTube +
  Facebook cùng lúc (giả API) với tiêu đề/mô tả/thẻ; chế độ `now` (YouTube chưa/đã kiểm duyệt, TikTok, Facebook
  không hẹn giờ); một nền tảng lỗi → chạy lại chỉ thử nền tảng đó; không tải lại nền tảng đã xong; render mới → đăng
  lại; `publish.video.options` (đã kết nối, video ngang, mặc định kênh).
- `apps/desktop/tests/unit/publish-step.test.ts`: chữ trạng thái/nhận diện bước đang chờ chọn.
- Workflow cài sẵn: kiểm manifest (`validateManifest`) có bước `publish` sau `render`.
