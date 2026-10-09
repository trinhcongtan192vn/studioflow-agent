# 093 — Tự sửa lỗi đúng chỗ sai (ít làm lại, ít token)

## Bối cảnh

Tan rà lỗi của video `vd_rbxtpyp5` (Nuvora, shorts, bật cả bốn tùy chọn Nâng cao) và muốn "cơ chế tự sửa lỗi: feedback
ngược cho agent để sửa đúng chỗ sai, hạn chế làm lại để tránh tốn token".

20 lần bước lỗi, gom thành 6 loại. Bốn loại đã có bản sửa (xảy ra trước khi merge): ID line sai mẫu (080), agent
dừng ở bước giọng đọc (083), hết lượt Claude (086), chữ ngoài vùng an toàn (088). Còn lại:

1. **Engine:** bước Kịch bản chạy lại và trượt gate (`artifact_valid(SCRIPT.md): unexpected marker`), nhưng điểm
   duyệt cũ (đã duyệt hôm trước) có file đổi hash nên bị đưa về `pending` và bước thành `waiting_approval` — người dùng
   bấm Duyệt cho qua một SCRIPT.md không có ID; bước Storyboard phải nhờ agent sửa tay hai lượt.
2. **SCRIPT.md:** model để dòng trống giữa đoạn và `<!-- sf:tts … -->` (hoặc viết `sf:tts` trước đoạn) → parser báo
   lỗi, bước gán ID bỏ qua, cả bản kịch bản hỏng.
3. **Frame AI:** vòng sửa sau lint/check gửi lại toàn bộ đề dựng frame → agent vẽ lại từ đầu (~11k token đầu ra mỗi
   frame) và vẫn còn `content_overlap` → cả bước Dựng frame lỗi.

## Yêu cầu

- FR-AG-93-01 (D4 2.4, D5 4): tool Gateway `artifact.edit {path, edits: {old, new}[], base_hash?}` cho phiên `main`,
  `frame`, `producer` — mỗi `old` phải xuất hiện đúng một lần (không có / nhiều lần → `E_SCHEMA_INVALID` kèm gợi ý);
  kết quả đi qua đúng đường ghi của `artifact.write` (phạm vi, owner, schema, gán ID, hỏi khi ghi đè file đã duyệt);
  không truyền `base_hash` → so với nội dung vừa đọc.
- FR-FB-93-02 (sửa tại chỗ): frame đã có file mà còn lỗi (kiểm file trong phiên, hoặc lint/check sau khi lắp) → phiên
  sửa nhận nội dung file hiện tại + danh sách lỗi (kèm selector) và chỉ dẫn sửa đúng phần tử bằng `artifact.edit`,
  không vẽ lại, giữ `data-sf-id`. Chưa có file → chỉ dẫn dựng như cũ.
- FR-FB-93-03 (phương án cuối, 0 token): frame AI vẫn lỗi sau vòng sửa (hoặc phiên lỗi không phải hết lượt) → dựng
  riêng frame đó từ mẫu (086), kiểm lại; tóm tắt bước nêu các frame này và cách cho AI vẽ lại (Quay lại). Hết lượt
  Claude vẫn dừng như 086.
- FR-WF-93-04 (marker kịch bản, tất định): `assignScriptIds` (executor `script` và `artifact.write`/`edit` của agent)
  sắp lại trước khi phân tích: bỏ dòng trống giữa đoạn và `sf:tts`; `sf:tts` đặt trước đoạn → dời ra sau đoạn.
- FR-WF-93-05 (engine, D6 3.1): điểm duyệt cũ chỉ quay về `pending` khi bước đang `done`/`waiting_approval` và đó là
  điểm duyệt mới nhất của bước; bước đang `running`/`failed`/`pending`/`stale` giữ nguyên (kết quả mới qua gate rồi
  tạo điểm duyệt mới).

## Test

- `tests/integration/gateway-edit.test.ts`; `tests/unit/script-repair.test.ts`;
  `tests/integration/frame-build.test.ts` (093: chỉ dẫn sửa tại chỗ, frame mẫu cho frame vẫn lỗi);
  `tests/integration/workflow-engine.test.ts` (093: bước lỗi / chờ chạy lại giữ trạng thái khi file đổi);
  `tests/integration/workflow-rewind.test.ts` (lần chạy lại lỗi giữ `failed`).
