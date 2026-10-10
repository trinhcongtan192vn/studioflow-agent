# D9 — Spec Studio và bảng caption

**Phiên bản:** 1.2 · **Ngày:** 03/10/2026
**Dựa trên:** `00-architecture.md` mục 10 · D3, D4 · **Spike:** S6 (chặn phần đánh dấu `[chờ S6]`)
**Phủ:** FR-ST-01..06, FR-WS-06, AC-M3-01..03 · **Tính năng:** 017 `studio-preview`, 025 `studio-commit`, 026 `caption-panel`

---

## 1. Nguồn sự thật

| Thông tin | Nguồn | Sửa bằng |
|---|---|---|
| Nội dung, cấu trúc | `STORYBOARD.md` + artifact miền | Chat; read-back từ Studio |
| Chi tiết trình bày | `compositions/frames/<fr>.html` (phần tử có `data-sf-id`) | Agent khi sinh; Studio |
| Trộn audio | `index.html` (thuộc tính phần tử audio) | Studio, chat |
| Caption chữ / kiểu / thời gian | `SCRIPT.md` / `caption-overrides.json` | Chat / Studio / bảng caption |

## 2. Chế độ xem trước (M1, tính năng 017)

- `studio.open {mode: 'preview'}`: chạy `hf-studio` (`hyperframes preview`) trực tiếp trên thư mục video, **chỉ đọc**: app chặn mọi thao tác lưu (chèn script vô hiệu nút lưu/phím tắt) `[chờ S6]`. Không đổi `owner`.
- Hiển thị nhúng trong panel phải của app; tự tải lại khi `index.html` đổi.

## 3. Chế độ chỉnh (M3, tính năng 025)

### 3.1 Mở
`studio.open` với `mode: 'edit'`:
1. Từ chối nếu có job đang ghi file cảnh của video (`E_STUDIO_BUSY`).
2. Đặt `state.json.owner = 'studio'`; ghi `owner_since`.
3. Tạo bản làm việc `.sf/studio-work/<session>/`: chép `index.html`, `compositions/`, `caption-overrides.json`, `hyperframes.json`; `public/` liên kết chỉ đọc (không chép). Trong phiên chỉnh, bảng caption bị khóa chỉ đọc (tránh xung đột `caption-overrides.json`).
4. Ghi `base.json`: hash từng file đã chép.
5. Chạy `hf-studio` trên bản làm việc; chèn CSS/JS ẩn trình sửa mã `[chờ S6]`.

### 3.2 Lưu — `studio.commit`
1. Diff từng file của bản làm việc với bản gốc tại thời điểm mở (`base.json`). File gốc đã đổi ngoài phiên (hash ≠ base) → `E_BASE_HASH_MISMATCH`, không ghi gì.
2. Phân tích HTML (parse DOM, không so chuỗi). Mỗi thay đổi được phân loại theo **danh sách thuộc tính cho phép** (mục 3.3). 094: file frame có thay đổi ngoài danh sách → **nhận nguyên frame** (mục 3.4 c): mục trong danh sách ghi từng thay đổi, phần còn lại gộp `{element_id:'*', attr:'frame'}`; kết quả có `whole_frames`. File khác (`index.html`, do builder dựng lại) có thay đổi ngoài danh sách, hoặc thêm/xóa file → từ chối toàn bộ commit với `E_STUDIO_DISALLOWED_CHANGE` kèm danh sách (phần tử, thuộc tính, lý do).
3. Kiểm mọi `data-sf-id` còn nguyên (không mất, không trùng).
4. Chạy `hyperframes lint` trên bản làm việc.
5. Read-back (mục 4); ghi các file qua `artifact.write` (bỏ qua kiểm owner cho chính phiên Studio).
6. Cập nhật `pinned_frames` (manual delta) cho frame có thay đổi trình bày.
7. Trả `{ changed_files, pinned_frames, readback_changes }`.

### 3.3 Danh sách thuộc tính cho phép `[chờ S6]`
Mặc định tạm, chốt bằng bảng "thao tác → thay đổi file" của S6:

| Loại | Cho phép |
|---|---|
| Vị trí/kích thước | thuộc tính style: `left, top, right, bottom, width, height, transform (translate/scale/rotate), opacity, z-index` trên phần tử có `data-sf-id` |
| Timing | `data-start`, `data-duration`, `data-*` timing của HyperFrames trên phần tử có `data-sf-id` |
| Keyframe | xem mục 3.4 |
| Grade/hiệu ứng | thuộc tính `data-color-grading*`, `data-media-*` |
| Caption kiểu | khối style caption → ghi vào `caption-overrides.json.style` |
| Audio | `data-volume*`, `data-fade-*` trên phần tử audio |
| Không cho phép | thêm/xóa phần tử, đổi thẻ, đổi `<script>`, đổi nội dung chữ, đổi `src`, đổi `data-sf-id` |

094: "không cho phép" chỉ còn áp cho `index.html`; trong file frame các thay đổi đó được nhận và frame ghim nguyên khối. Proxy chế độ chỉnh cho mọi API sửa phần tử/GSAP/hoàn tác và lưu mã thô file cảnh (`index.html`, `compositions/**/*.html`); chặn render, tải lên, tách nền, nhân bản/xóa file, ghi ngoài file cảnh.

### 3.4 Keyframe
Tùy kết quả S6 (c):
- **(a) Mặc định thiết kế:** blueprint đặt keyframe dạng dữ liệu `data-sf-keyframes='[{"t":0,"x":..}]'` trên phần tử; runtime nhỏ trong frame đọc và dựng timeline GSAP. Studio sửa thuộc tính này → nằm trong danh sách cho phép.
- **(b)** Nếu Studio chỉ sửa mã GSAP: diff theo cây cú pháp JS, chỉ nhận thay đổi giá trị số/chuỗi trong lời gọi `gsap.to/from/fromTo/set` và vị trí trên timeline đã có.
- **(c)** Nếu (a)(b) không khả thi: nhận cả file frame sau lint, đánh dấu cả frame `pinned` với `changes: [{element_id:'*'}]`; việc ẩn trình sửa mã trở thành lớp bảo vệ chính.

### 3.5 Đóng
`studio.close`: nếu còn thay đổi chưa commit → hỏi người dùng (commit / bỏ). Dừng `hf-studio`; xóa bản làm việc; `owner = 'agent'`.

**Khóa còn sót (045):** app tắt khi phiên sửa còn mở → `owner = 'studio'` ở lại trong `state.json` mà không có phiên nào (phiên chỉ sống trong tiến trình). Mở lại video (`video.open`) → nhả khóa (`owner = 'agent'`); bản làm việc không có thay đổi chưa commit thì xóa, có thì **giữ lại** trong `.sf/studio-work/<ss>/` và báo trong chat (danh sách file). Đóng app khi phiên Studio / bước workflow / job / agent còn chạy → giao diện hỏi xác nhận (`app.activity`); 052: kèm danh sách video Autopilot đang làm (`autopilot`: kênh, video, mục kế hoạch, tiêu đề) — đóng app giữa chừng thì lần mở sau tự làm tiếp đúng video đó. `app.activity.queued` = số job đang xếp hàng. **Hẹn giờ ngủ đông** (2026-10-10, thanh dưới): bật kèm X phút; khi không còn bước/job (chạy hoặc xếp hàng)/agent nào chạy liên tục X phút → hộp đếm ngược 60 s (Hủy) → `main` chạy `shutdown /h`; bật một lần, ngủ đông xong tự tắt.

### 3.6 File watcher (FR-WS-06)
`core` theo dõi thư mục video; thay đổi không do `core` ghi (so với nhật ký ghi của Gateway) → thông báo người dùng, đánh dấu file `external_change` trong `graph.status`, không tự ghi đè.

## 4. Read-back
Thay đổi trong Studio thuộc lớp nội dung được ghi ngược về `STORYBOARD.md`:

| Thay đổi trong HTML | Ghi về |
|---|---|
| Đổi preset grade (`data-color-grading` = id look) | `sf-scene.look` hoặc `sf-frame.config.look.id` |
| Bật/tắt khối overlay catalog | `sf-frame.overlays` |
| Dời lớp miệng | `CastMember.mouth_anchor` (cast cấp video) |
| Thay đổi trình bày khác | không read-back; vào manual delta |

## 5. Frame ghim
- Frame có manual delta → nút `frame_html` trạng thái `pinned`. Agent/engine không ghi file frame đó nếu chưa được người dùng cho phép (Gateway trả `permission_request`).
- Đầu vào đổi → `pinned_stale`; UI hiện lựa chọn: **Giữ bản chỉnh tay** (cập nhật `input_hash`, nút về `pinned`) · **Sinh lại rồi áp lại chỉnh tay** (phiên `frame` nhận `pinned_delta`; áp từng thay đổi lên phần tử cùng `data-sf-id`; thay đổi không áp được liệt kê cho người dùng) · **Sinh lại bỏ chỉnh tay** (xóa delta, sao lưu bản cũ).

## 6. Bảng caption (M3, tính năng 026)

Hợp đồng (chi tiết tương tác: FN-026):
- Component của app, **không thuộc Studio**; chỉ đọc khi `owner = studio`.
- **Đọc:** `caption_groups.json`, `caption-overrides.json` (D3 mục 5.8), `.sf/preview/voice.wav` và `.sf/preview/waveform.json` (dẫn xuất, engine sinh từ `audio/lines` + `audio_meta`).
- **Ghi duy nhất** `caption-overrides.json` qua `artifact.write` có `base_hash`: thời gian cụm (`groups[id].start_ms/end_ms`), chữ hiển thị (`groups[id].text`), `splits`, `merges`. Không đổi `SCRIPT.md`, không đổi audio.
- Bất biến khi lưu: các cụm của cùng line không chồng nhau; `start_ms < end_ms`; mốc nằm trong khoảng audio của line.
- Sau khi lưu: nút `captions` và `index` lỗi thời (D4 mục 8).

## 7. Mã lỗi

| Mã | Khi |
|---|---|
| `E_STUDIO_BUSY` | Có job đang ghi file cảnh |
| `E_VIDEO_BUSY` | Xóa video đang chạy bước / mở Studio / agent đang trả lời / Autopilot đang làm (064) |
| `E_STUDIO_DISALLOWED_CHANGE` | Commit có thay đổi ngoài danh sách cho phép |
| `E_BASE_HASH_MISMATCH` | File gốc đổi trong lúc chỉnh |
| `E_STUDIO_PROCESS` | `hf-studio` không khởi động/đã thoát |
