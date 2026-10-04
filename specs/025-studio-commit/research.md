# Research — 025 (spike S6, phần chỉnh)

## R1. Studio ghi file thế nào (hyperframes 0.8.115)
- Server Studio (`studioServer`) ghi thẳng vào thư mục dự án qua API: `POST /api/projects/:id/file-mutations/patch-element/*` (thao tác `inline-style`, `attribute` (`data-*`), `html-attribute`, `text-content`; đích `{hfId | id | selector}`), `patch-elements-batch`, `gsap-mutations/*` + `gsap-mutations-batch` (sửa mã GSAP — keyframe là mã, không phải dữ liệu), `PUT/PATCH/POST /api/projects/:id/files/*` (lưu mã thô từ trình sửa mã), `insert-composition`, `remove-element(s)`, `wrap/unwrap/split`, `duplicate-file`, `registry/install`, `render`.
- Studio tự chuẩn hóa `index.html` khi mở (017 R1) → so DOM, không so chuỗi.

## R2. Proxy chặn API
- Không chèn được CSS vào iframe khác origin để ẩn trình sửa mã. Proxy cục bộ trước Studio: cho qua GET/HEAD, `file-mutations/patch-element*`, `probe-element*`, `gsap-mutations*`, `gsap-mutation-rollback`, `selection`, `lint`, `preview`; chặn (403, JSON giải thích) `files/*` ghi, `duplicate-file`, `remove-element*`, `insert-composition`, `wrap/unwrap/split`, `registry/install`, `render`, `loudness/normalize`, `freeze-frame`. WebSocket đi xuyên.
- `text-content` qua `patch-element` không chặn được ở proxy (cùng endpoint) → diff khi commit từ chối.

## R3. Keyframe (D9 3.4)
- Frame do agent viết dùng GSAP trong `<script>` (011), không có `data-sf-keyframes` → phương án (b): so chuỗi token JS; chỉ cho khác ở token số/chuỗi. Đủ cho Studio đổi giá trị trong `gsap.to/from/set` và vị trí trên timeline (tham số số).

## R4. Áp lại delta
- `ManualDelta.changes` lưu `element_id, attr, before, after` (attr = `style.<prop>`, `data-*`, hoặc `script`). Áp lại tất định trên frame dựng lại: style/attr theo phần tử cùng `data-sf-id`; `script` không áp tự động (trả về danh sách không áp được).
