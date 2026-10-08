# 079 — Autopilot tự sửa cách đọc dòng đọc sai trước khi đỗ video

## Vấn đề
Dòng bị ASR nghe lệch nhiều (> ngưỡng × `autopilot.asr_accept_ratio`) làm Autopilot đỗ video chờ người. Sinh lại tự động (`asr.max_regen` = 1) dùng cùng chữ nên TTS thường đọc sai y như cũ — nguyên nhân hay gặp là số, đơn vị, viết tắt, tên riêng, từ nước ngoài (vd_jegcn38v: 4 dòng). Tan (2026-10-08): tự sinh lại trước khi đỗ (rà soát Autopilot, mục 8).

## Yêu cầu
- FR-AP-79-01 Bước lỗi `asr_clean` có dòng lệch nhiều → bộ chạy nhờ agent một lần mỗi bước (`fixAsr`, nhật ký `asr.fix` kèm line + % lệch), rồi kiểm tra lại bước; vẫn lệch → đỗ như cũ, lý do ghi "đã nhờ agent sửa cách đọc nhưng vẫn lệch". Agent chạm hạn mức / lỗi chung → chờ (NFR-11, 078) và được thử lại.
- FR-AP-79-02 Host: `fixAsr` gửi phiên `main` của video chỉ dẫn `asrFixInstruction`: đọc SCRIPT.md + audio_meta.json, sửa/ thêm `<!-- sf:tts text="…" -->` dưới đúng dòng (giữ chữ hiển thị), `asr.align` đúng các line, `job.wait`; host chờ hàng job rảnh (≤ 15 phút) rồi mới để bộ chạy kiểm tra lại. Ghi đè SCRIPT.md đã duyệt được tự cho phép ở video Autopilot (077).

## AC
- `autopilot-runner.test.ts`: agent sửa được → produced, gọi một lần; không sửa được → đỗ sau một lần với lý do mới; không có `fixAsr` → đỗ như trước.
- `asr-fix-instruction.test.ts`: chỉ dẫn có line + %, dạng sf:tts, asr.align với đúng line_ids, job.wait.
