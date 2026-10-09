# 094 — Studio lưu được mọi thay đổi của frame

## Bối cảnh

Tan chỉnh vài khung hình trong Studio, bấm Lưu thì bị từ chối:
`compositions/frames/fr_w7gaujyy.html el_huplfy8q/div[1]/div[1] style.translate: chỉ chỉnh được phần tử có data-sf-id`.
Tan muốn Lưu được với bất kỳ loại thay đổi nào. Chọn (MCQ): **lưu nguyên frame** theo D9 3.4 (c).

## Yêu cầu

- FR-ST-94-01 (D9 3.2–3.3): `studio.commit` — file frame (`compositions/frames/fr_*.html`) có thay đổi ngoài danh
  sách cho phép → vẫn nhận (nếu `hyperframes lint` qua, `data-sf-id` không trùng); thay đổi trong danh sách ghi từng
  mục như cũ (áp lại được), phần còn lại gộp thành `{element_id: '*', attr: 'frame'}` trong `pinned_frames`; kết quả
  có thêm `whole_frames`. `index.html` và file khác giữ luật cũ (builder dựng lại); thêm/xóa file vẫn bị từ chối.
- FR-ST-94-02 (D9 3.1, proxy FR-ST-03): chế độ chỉnh cho mọi API sửa phần tử (`file-mutations/*`), GSAP, hoàn tác,
  lưu mã thô file cảnh (`index.html`, `compositions/**/*.html`). Vẫn chặn: render, tải lên, tách nền, nhân bản / xóa
  file, ghi file ngoài cảnh (`public/` là liên kết tới thư mục thật), đổi/xóa project. Xem trước giữ chỉ đọc.
- FR-UI-94-03: thông báo sau Lưu nêu frame lưu nguyên khối và việc sinh lại không áp lại tự động phần chỉnh tự do
  (D9 5 "Sinh lại rồi áp lại" liệt kê mục `*` là không áp được).

## Test

- `tests/integration/studio-edit.test.ts` (AC-M3-02 / 094); `tests/unit/studio-proxy.test.ts`.
