# D10 — Spec UI: danh mục màn hình và hợp đồng IPC

**Phiên bản:** 1.4 · **Ngày:** 10/10/2026
**Dựa trên:** D1 mục 7 (hành trình), D4–D9
**Phủ:** FR-WS-02, FR-CH-02/03/04/07, FR-WF-02/03, FR-SC-03/06, FR-OP-06, FR-OB-03 · **Tính năng:** 008, 014, 024, 026, 028

Tài liệu này chỉ chốt **những gì mọi tính năng UI phải tuân theo**: danh mục màn hình, quy tắc giao diện chung, nội dung bắt buộc của thẻ duyệt/xác nhận, và hợp đồng IPC. Bố cục, tương tác chi tiết, phím tắt: FN-008 và ghi chú của từng tính năng.

---

## 1. Danh mục màn hình

| Mã | Màn | Nội dung chính | GĐ |
|---|---|---|---|
| UI-01 | **Onboarding** | Chào → đăng nhập Claude (trạng thái `authStatus`) → chọn hồ sơ cài đặt (Tối thiểu/Chuẩn/Đầy đủ, hiện dung lượng) → tiến độ tải từng thành phần (tạm dừng/tiếp tục) → (tùy chọn) khóa OpenAI/DeepSeek/API ảnh → xong | M1 |
| UI-02 | **Trang chủ** | Danh sách kênh gần đây; "Mở thư mục kênh"; "Tạo kênh mới" (chọn thư mục → mở chat khởi tạo kênh) | M1 |
| UI-03 | **Không gian kênh** | Thanh trái (kênh, video, explorer), chat, panel phải theo tab (bố cục: FN-008); chọn video trong thanh trái; "Video mới" | M1 |
| UI-04 | **Tab Tiến độ** | Danh sách bước từ `workflow.yaml` + `state.json`: biểu tượng trạng thái, thời gian, nút "Chạy lại bước", "Quay lại bước này"; với bước có refine: số vòng, điểm cuối, nhãn "chưa đủ vòng" | M1 |
| UI-05 | **Tab Xem trước** | Studio nhúng (preview/edit); nút "Chỉnh trong Studio" (M3) / "Lưu" / "Đóng"; nút "Render nháp", "Render phát hành" | M1/M3 |
| UI-06 | **Tab Job** | Bảng job: loại, video, trạng thái, tiến độ, engine, thời gian; hủy, thử lại; lọc theo video | M1 |
| UI-07 | **Tab Nhạc** | Kho nhạc (app + kênh): bảng bài (tên, thời lượng, BPM, energy, tag, nguồn), nghe thử, sửa tag/ghi công, kéo thả để nạp, ô tìm (dùng `music.find`) | M1 |
| UI-08 | **Tab Trace** | Danh sách lần chạy (bước/phiên) → cây span, thời gian, token, chi phí; nút "Mở trong Phoenix" khi bật | M1 (đơn giản), M3 |
| UI-09 | **Cài đặt** | Tài khoản (Claude, khóa API — chỉ hiện 4 ký tự cuối); Provider theo capability; Model viết/critic/phụ mặc định; Hồ sơ cài đặt + model đã cài (gỡ); Ngân sách mặc định; Mạng cho phép; Thư mục dữ liệu | M1 |
| UI-10 | **Dung lượng** | Theo kênh: cache, render, sao lưu; model; nút dọn từng mục (hiện dung lượng sẽ giải phóng) | M2 |
| UI-11 | **Bảng caption** | D9 mục 6 | M3 |
| UI-12 | **Báo cáo chi phí** | Theo video và bước: token vào/ra, chi phí API, thời gian GPU; so ngân sách | M3 |

## 2. Quy tắc chung (ràng buộc)

### Autopilot chung (096)

Nguồn cho CTA Tạo video: truyền URL nguồn trong brief và chat. Agent dùng các tool MCP sẵn có để lấy metadata/transcript và phân tích theo luồng tạo video tham khảo hiện tại. Không thêm cơ chế tải/lưu transcript riêng cho CTA.

Bổ sung 10/10/2026: mỗi mục chưa tạo video có CTA **Tạo video** và **Xóa**, kể cả bản xem thử. Tạo video chuyển riêng mục đó sang luồng thủ công, mở workspace video và giao brief cho agent; lấy ngôn ngữ mặc định hiện tại của kênh, giữ chủ đề/góc nhìn/nguồn/workflow/dạng xuất, giữ các điểm duyệt thủ công và không tự đăng. Mục được đánh dấu `skipped` kèm `video_id` để Autopilot không tạo trùng. Bấm lặp trả cùng video. Xóa mục đã lưu là đánh dấu `skipped` với ghi chú xóa và ẩn khỏi danh sách, không xóa file video; bản xem thử chỉ xóa cục bộ. Mục đang/đã chạy chỉ có Mở video, không cho tạo thêm hoặc xóa. Hai IPC bổ sung: `autopilot.plan.remove {channel,date,item_id}` → `{item}`; `autopilot.plan.create_video {channel,date,item_id,preview?:DailyPlan}` → `{video_id,created}`. Preview chỉ nhập mục được chọn, không lưu những mục khác, không bật kênh hoặc bỏ tạm dừng.

Cập nhật 10/10/2026: bỏ các khối hiển thị năng lực và cách tính giới hạn trên trang Autopilot và bản xem thử; giao diện không gọi riêng `autopilot.capacity`. Bộ lập kế hoạch vẫn áp dụng cấu hình hiện có và giải thích khi không có mục phù hợp.

Trang Autopilot quản lý kế hoạch hôm nay, danh sách mọi kênh quản lý (kể cả kênh tắt), bật/tắt từng kênh và duyệt trước khi đăng. Bỏ mục Đăng riêng trên sidebar; lối tắt duyệt đăng mở khu vực tương ứng trong Autopilot. Video chờ đăng của kênh đã tắt vẫn phải hiện.

Tắt kênh trong lúc đang sản xuất: bước đang chạy được hoàn tất, không bắt đầu bước/video mới của kênh; giữ video dở để tiếp tục khi bật lại. Kênh khác vẫn được chạy. Tắt Autopilot không thay thế thao tác Hủy đăng đối với video đã được lên lịch trên nền tảng.

Nút lập lại kế hoạch chỉ bổ sung chỗ trống, giữ các mục đã có. Không có kênh bật hoặc toàn cục đang tạm dừng thì không xếp job và hiển thị lý do. UI theo dõi job đến trạng thái cuối, hiển thị số mục hoặc nguyên nhân không có mục; lỗi không được biến thành trạng thái rỗng.

Xem thử kế hoạch cho một kênh dùng cùng bộ chọn chủ đề, năng lực và lịch đăng, hoạt động cả khi kênh tắt/toàn cục tạm dừng. Có thể cập nhật nghiên cứu và dữ liệu học qua Gateway; không ghi kế hoạch sản xuất (kể cả kế hoạch hôm qua), không bật kênh, tạo video hoặc đăng bài. Bản xem thử được gắn nhãn rõ, chỉ xem; lịch chính thức sẽ được tính lại khi chạy thật. Không thay đổi schema artifact.

### Thư viện dạng bảng (097)

Thư viện hiển thị các bản render đã hoàn tất theo bảng có thumbnail, tiêu đề video, loại bản (nháp/phát hành), định dạng, ngày hoàn tất và thao tác xem/xuất/mở video/mở thư mục. Có tìm kiếm, lọc Video/Shorts, lọc loại bản, sắp xếp ngày mới/cũ và phân trang 10/25/50 dòng. Đổi bộ lọc hoặc kênh về trang đầu; dữ liệu ít đi thì trang hiện tại được kẹp về trang hợp lệ. Trạng thái lỗi tải phải hiện rõ và cho thử lại. Không thêm số liệu lượt xem/bình luận khi chưa có dữ liệu. Tái dùng hợp đồng render.library; mỗi dòng vẫn là một bản render, nhận diện bằng video_id + render_id.
- Ngôn ngữ giao diện tiếng Việt; thông báo lỗi lấy từ Gateway.
- Explorer **chỉ đọc**: không có thao tác tạo/sửa/xóa/đổi tên file trong project (FR-WS-02).
- UI không bao giờ ghi file project trực tiếp; mọi thay đổi đi qua IPC tới `core` (module ghi của Gateway).
- UI tiến độ workflow dựng từ `workflow.yaml` + `state.json`; **không có mã UI riêng cho từng workflow** (FR-WF-02).
- Thao tác dài không khóa toàn UI; trạng thái job lấy từ sự kiện `job.updated`.
- Khóa API chỉ hiển thị 4 ký tự cuối; nhập khóa đi thẳng tới `main` (Credential Manager).

## 3. Thẻ trong chat (nội dung bắt buộc)
- **Thẻ duyệt** (từ `approval.requested`): tên bước; tóm tắt (bước có refine: điểm từng vòng, vấn đề đã sửa/còn lại, nhãn "chưa đủ vòng"/"critic cùng hãng" nếu có); link xem artifact; hành động **Duyệt**, **Yêu cầu sửa** (kèm ghi chú), **Quay lại bước trước** → `approval.decide` / `workflow.rewind`.
- **Thẻ xác nhận** (từ `permission.requested`): hành động, ước tính số lượng/thời gian/chi phí; **Đồng ý** / **Từ chối**; "Luôn cho phép trong video này" khi chính sách cho phép (D5 mục 5.1) → `permission.decide`.
- **Đính kèm:** gọi `upload.ingest`; giới hạn 200 MB/file (`E_UPLOAD_TOO_LARGE`); loại file cho phép: ảnh, audio, văn bản (danh sách cụ thể: FN-008).
- **Ngữ cảnh** (M3): gửi dưới dạng `context_refs` (D5 mục 1).

## 4. IPC renderer ↔ core (hợp đồng)

JSON-RPC 2.0 (kênh truyền: tech-defaults). Phương thức (renderer gọi) và sự kiện (core đẩy):

| Phương thức | Mô tả |
|---|---|
| `app.status` | Trạng thái cài đặt, đăng nhập, engine |
| `channel.open` / `channel.init` / `channel.list_recent` | |
| `video.list` / `video.create` / `video.open` | |
| `chat.send` / `chat.interrupt` / `chat.history` | |
| `upload.ingest` | `{path_on_disk}` → `{rel_path}`; chép qua module ghi của Gateway |
| `approval.decide` | `{approval_id, decision, note?}` |
| `permission.decide` | `{request_id, allow, remember?}` |
| `workflow.run_to` / `workflow.pause` / `workflow.rewind` / `workflow.run_step` | |
| `job.list` / `job.cancel` / `job.retry` | |
| `studio.open` / `studio.commit` / `studio.close` | |
| `captions.load` / `captions.save` | |
| `music.list` / `music.add` / `music.update` / `music.find` | |
| `settings.get` / `settings.set` / `secrets.set` / `secrets.delete` | Khóa chuyển cho `main` lưu |
| `codex.status` / `codex.login` (095) | Trạng thái gói ChatGPT / bắt đầu OAuth, trả `{auth_url}` để UI mở trình duyệt; không nhận API key |
| `asr.accept` | Chấp nhận line lệch ASR |
| `install.plan` / `install.start` / `install.pause` | |
| `disk.usage` / `disk.clean` | |
| `trace.list` / `trace.get` / `cost.report` | |
| `autopilot.plan.get` | `{channel?, date?}` → kế hoạch ngày (D3 5.18) của mọi kênh Autopilot (051); `channel` bỏ trống = tất cả kênh quản lý đang bật Autopilot |
| `autopilot.plan.run` | `{date?}` → `{job_id}`: lập/lập lại kế hoạch hôm nay cho mọi kênh Autopilot (051, việc dài → job, D4 2.3); `date` chỉ nhận hôm nay |
| `autopilot.plan.preview` | `{channel}` → `{job_id}`: job xem thử một kênh, không lưu kế hoạch sản xuất; kết quả job chứa `plans[].plan` (DailyPlan), `preview: true` |
| `job.get` | `{job_id}` → `{job: JobInfo}`: lấy trạng thái/kết quả chính xác của job, kể cả khi UI bỏ lỡ sự kiện hoàn tất |
| `autopilot.plan.update` | `{channel, date, item_id, patch}` → mục đã sửa (051): bỏ qua/khôi phục, đổi tiêu đề, góc nhìn, workflow, giờ đăng; không sửa mục đang/đã làm |
| `autopilot.status` | `{}` → `{paused, running, waiting_until?, current?: {channel, video, item_id, step_id?}, today: [{channel, name, date, items[]}]}`: Autopilot đang làm gì, trạng thái từng mục kế hoạch hôm nay (052) |
| `autopilot.run_now` | `{}` → `{started, reason?}`: chạy một lượt ngay (lập kế hoạch nếu chưa có rồi làm lần lượt các mục), bỏ qua khung giờ làm việc; không chạy khi đang tạm dừng (052) |
| `autopilot.pause` / `autopilot.resume` | `{}` → `{paused}`: đặt `autopilot.paused` (app) (052) |
| `learning.get` | `{channel?}` → `{learning: ChannelLearning[]}`: điều chỉnh điểm chủ đề đã học (mặc định mọi kênh Autopilot; kênh chưa đủ dữ liệu trả `enough_data: false`) (057) |
| `report.latest` | `{channel?}` → `{reports: DailyReport[]}`: báo cáo ngày gần nhất đã lập của kênh (mặc định mọi kênh Autopilot) (054) |
| `report.run` | `{channel?, send?}` → `{reports: DailyReport[], text: string}`: lập báo cáo ngay (thu số liệu mới nếu cũ); `send: true` gửi vào Telegram (054) |
| `publish.youtube.connect` | `{channel}` → `{auth_url}`: bắt đầu OAuth cho kênh (UI mở `auth_url` bằng trình duyệt; app đợi mã ở cổng loopback tối đa 5 phút) (053) |
| `publish.youtube.status` | `{channel}` → `{connected, audited, youtube_channel_id?, channel_title?, quota{used, limit}, error?}` (053) |
| `publish.youtube.disconnect` | `{channel}` → `{ok}`: thu hồi và xóa token (053) |
| `publish.tiktok.set_token` / `publish.facebook.set_token` | `{channel, token, page_id?}` (`page_id` chỉ Facebook, ghi `publish.facebook.page_id`) → `{ok}`: lưu token đã dán vào Credential Manager (qua `main`); không bao giờ trả lại token (056) |
| `publish.tiktok.status` / `publish.facebook.status` | `{channel}` → `{connected, audited?, page_id?}` (056) |
| `publish.tiktok.disconnect` / `publish.facebook.disconnect` | `{channel}` → `{ok}`: xóa token (056) |
| `publish.cancel` / `publish.now` | `{channel, date, item_id, platform?}` → `{status, url?, note?}`: Hủy đăng / Đăng ngay trong cửa sổ phản đối (053) |
| `publish.video.options` | `{channel, video}` → `{render: {id, output_profile} \| null, meta: {title, description, tags}, platforms: [{platform, label, connected, eligible, reason?, checked, state?}], requested_at}`: bộ chọn nền tảng của bước `publish` (091) |
| `publish.video.start` | `{channel, video, platforms}` → tóm tắt workflow: ghi lựa chọn vào `publish-state.json` rồi chạy bước `publish`; `platforms` rỗng = không đăng (091) |
| `telegram.status` | `{}` → `{enabled, state, reason?, bot_username?, chat_id_set, has_token, last_error?}`: bot Telegram đang chạy/tắt và vì sao (token sai, xung đột getUpdates…) (055) |
| `telegram.test` | `{}` → `{ok}`: gửi tin thử vào `telegram.chat_id` (055) |
| `telegram.set_token` | `{token}` → `{ok, bot_username}`: kiểm token bằng `getMe` rồi lưu bí mật `telegram_bot_token` qua `main`, khởi động lại bot (055) |
| `sessions.list` / `sessions.get` | (048) không có `channel` → nhật ký các phiên `ops` (Telegram) trong dữ liệu app (055) |
| `autopilot.capacity` | Ước tính số video làm được hôm nay cho các kênh quản lý (050, FN-050): thời gian từng bước trên máy, ngân sách Claude, hạn mức đăng YouTube |

| Sự kiện | Dữ liệu |
|---|---|
| `chat.event` | `AgentEvent` (D5) + `session_id` |
| `job.updated` | `JobInfo` |
| `workflow.updated` | `VideoState` rút gọn |
| `approval.requested` / `permission.requested` | thẻ (`permission.requested` mang `request_id` dùng cho `permission.decide`) |
| `artifact.changed` | `{path, hash, by}` |
| `install.progress` | `{component, done, total}` |
| `core.health` | `{ok, engines}` |
| `autopilot.updated` | cùng dữ liệu `autopilot.status` — phát mỗi lần trạng thái Autopilot đổi (052) |

Tên đầy đủ tham số và kiểu trả về được sinh từ `packages/core/ipc/schema.ts` (tính năng 008), phải khớp bảng này.

## Tab Xem trước — xem lại kết quả từng bước (2026-10-10)

- Dải các bước (xong / đang chạy / chờ duyệt / lỗi), rồi các mục hiện dần khi bước tương ứng xong: **video** (bản phát hành, chưa có thì bản nháp chờ duyệt), **giọng đọc** (nghe cả lời đọc — core ghép audio các line thành `.sf/preview/narration-<hash>.wav`; mỗi người nói một thẻ: giọng đang dùng, chọn giọng ref khác của kênh kèm nghe câu mẫu, "Dùng giọng này" → `voice.assign`, rồi "Đọc lại bằng giọng mới" → chạy lại bước Giọng đọc; nghe từng câu theo beat), **cảnh** (lưới ảnh — khung dọc với shorts — layout, chuyển động, chữ trên hình, lời đọc, prompt ảnh đang chờ), **nhạc** theo scene, **ảnh chụp frame**. Studio, render, xuất và bảng phụ đề ở mục "Chỉnh chi tiết" bên dưới.
- IPC: `video.review`, `voice.speakers`, `voice.assign`, `voice.preview`.
- Chat: bước Giọng đọc xong có nút **"▶ Nghe thử"** — mở trình phát cả lời đọc ngay dưới thẻ.

## Design system của kênh (2026-10-10)

- Cài đặt kênh → mục **Design system**: "✨ AI đề xuất phương án" (job nền `design.propose`: Opus đọc thông tin kênh, đề xuất 3 phương án khác nhau rõ rệt, mỗi phương án một ảnh mẫu Qwen) → thẻ phương án có khung mẫu dựng bằng chính màu/font + ảnh mẫu → "Chọn phương án này" → chỉnh tay (màu, font, viết hoa, độ đậm, phong cách ảnh, layout ưu tiên/cấm, nhịp, tâm trạng nhạc) → Lưu.
- Lưu ở `profile/design-system.json` của kênh (phương án: `profile/design-proposals.json`). Bước Design system của video ghi `frame.md` từ bản của kênh (kèm `design_look`, `design_images` để biết video lệch phần nào). Bước Đạo diễn nhận phong cách ảnh/layout/nhịp/nhạc của kênh; **mọi prompt ảnh được gắn phong cách ảnh của kênh** bằng code. Bộ layout dùng màu, font, viết hoa, độ đậm.
- Đổi design khi video đang làm (chưa render phát hành): tab Xem trước hiện banner "Áp dụng" — phong cách ảnh đổi → làm lại từ Đạo diễn hình; chỉ màu/chữ đổi → Dựng hình lại. Video đã phát hành giữ nguyên.
- IPC: `design.get`, `design.propose`, `design.choose`, `design.save`, `design.status`, `design.apply_video`.

