# Research — 032

## R1. Ai dựng miệng
FN-032 gợi ý blueprint `character-talking` đổi SVG bằng GSAP. Blueprint chưa có (gói blueprint ngoài backlog) và để phiên frame (LLM) tự viết timeline miệng thì không tất định. Chọn: phiên frame chỉ đặt **layer `mouth` rỗng** đúng chỗ (quy tắc packet), app chèn ảnh miệng + `tl.set` theo cue ở bước hoàn thiện frame (như look/hiệu ứng 027) → đổi lời/cue chỉ áp lại, không gọi agent; Studio vẫn chỉnh vị trí layer miệng được.

## R2. Thuật toán (S10 chưa chạy)
Ngưỡng 0,15/0,35 RMS chuẩn hóa theo đỉnh của line (FN-032 `[chờ S10]`). Làm mượt bằng gộp đoạn < 2 frame vào đoạn trước (tránh miệng nhấp nháy). Cue chỉ ghi ở frame đổi trạng thái; luôn kết bằng `closed`.

## R3. Góc nhìn
`FramePacket`/`Frame.lipsync` không có góc → dùng `front`; bộ `three_quarter` có sẵn cho khi hợp đồng thêm góc.

## R4. Thứ tự bước
`lipsync` chạy trước `frames` (D6). Frame dựng lại sau đó (do lời đổi) vẫn có miệng vì chèn ở hoàn thiện; `frame_html` phụ thuộc nút `lipsync.line` nên graph dựng cue trước.
