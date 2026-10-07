# 061 — Báo sớm điều chặn render phát hành; Autopilot tự xử lý dòng đọc sai

## Vấn đề
Render phát hành chỉ báo "lines still misread" (ASR) sau khi đã chờ render; người dùng không biết trước. Autopilot gặp lỗi này thì kẹt.

## Yêu cầu
- FR-RD-61-01: `finalize` có kiểm mềm `asr_clean` (D6): còn line `asr_flag = mismatch` → `E_GATE_WARNING`, chi tiết nêu id line + tỉ lệ lỗi. `audio_duration` + `asr_clean` là kiểm mềm; chỉ `audio_duration` miễn được bằng `workflow.waive`.
- FR-RD-61-02: Giao diện (chat + Tiến độ): "Còn N dòng đọc sai … — render phát hành sẽ bị chặn"; nút Nghe ln_… (tối đa 4), **Chấp nhận N dòng** (`asr.accept` rồi kiểm tra lại), Sửa cho đúng (nhờ agent), Kiểm tra lại; tiêu đề ⚠ Cảnh báo.
- FR-AP-61-03: Autopilot: dòng đọc sai có tỉ lệ lỗi ≤ `asr.wer_threshold.<ngôn ngữ>` × `autopilot.asr_accept_ratio` (mặc định 1,5) → tự `asr.accept` + kiểm tra lại (nhật ký `asr.accept`); lớn hơn → đỗ mục kèm id + tỉ lệ.

## AC
- Runner: lỗi nhỏ tự chấp nhận → produced; lỗi lớn → needs_review kèm "ln_… lệch 40%".
- Unit desktop: id line, câu dễ hiểu, CTA, nút Tiến độ.
