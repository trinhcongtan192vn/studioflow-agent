# 046 — Hoàn thiện luôn lỗi "index/credits stale" + cảnh báo thời lượng không có nút bỏ qua

## Vấn đề (vd_4h514vv8, bước Hoàn thiện)
Lỗi gộp `graph_fresh(*): index: stale; credits: stale; objective(audio_duration): 294 s vs 360 s`.
1. Nút `index` băm file frame **lúc bắt đầu build**; trong cùng lần build nút `frame_html` ghi lại frame (hoàn thiện effects/overlay) → `index` (và `credits` phụ thuộc) "stale" ngay sau build, mọi lần.
2. Lỗi thời lượng đã được chấp nhận ở bước Giọng đọc nhưng `finalize` kiểm lại (timeline) và hỏi lại.
3. Giao diện: câu dễ hiểu chỉ nêu cảnh báo (che lỗi `graph_fresh`), và nút "Bỏ qua cảnh báo" chỉ hiện khi *mọi* lỗi là cảnh báo.

## Yêu cầu
- FR-GR-46-01: phần băm của `index` tính lúc băm nút (hàm), như `credits` — hash không đổi khi nội dung không đổi (dự án cũ không bị stale hàng loạt).
- FR-WF-46-02: miễn trừ kiểm mềm áp dụng cho bước sau: tập miễn trừ = của bước + của các bước đã xong. Chạy lại bước đã miễn → miễn trừ mất.
- FR-CH-46-03: lỗi gộp → câu dễ hiểu nêu từng gate (`graph_fresh` → "Còn phần chưa dựng xong (…) — bấm Chạy lại"); có cảnh báo thời lượng kèm lỗi khác → vẫn có nút "Bỏ qua cảnh báo (thời lượng)" (không phải nút chính) ở chat và tab Tiến độ.

## AC
- `graph-full.test.ts` AC-M2-02: sau build có frame dựng lại, không nút nào `stale`.
- `workflow-waive.test.ts`: miễn ở bước 1 → bước 2 cùng kiểm qua.
- Unit desktop: lỗi gộp → `hasDurationWarning`, câu nêu đủ, CTA `retry, waive, recheck`; `stepButtons` mixed.
