# 048 — Giao diện chính: vào thẳng, bộ chọn kênh, lịch sử phiên agent

## Yêu cầu của Tan (2026-10-07)
- Mở app vào thẳng giao diện chính, không qua trang chọn kênh; thêm thư mục kênh / tạo kênh ngay trong giao diện chính.
- Sidebar dễ chuyển kênh, xem lịch sử phiên agent; Explorer ít dùng → chỉ cần lối vào "Chi tiết kênh".
- Lịch sử mọi phiên agent (audit log) xem lại được, cả Autopilot lẫn Manual (FR-AP-14).

## Yêu cầu
- FR-UI-48-01: Khởi động → mở kênh `SF_OPEN_CHANNEL` hoặc kênh dùng gần nhất còn tồn tại; không có → giao diện chính trống với nút "Thêm hoặc tạo kênh…". Bỏ trang chủ riêng.
- FR-UI-48-02: Đầu sidebar: bộ chọn kênh — kênh đang quản lý kèm nhãn Autopilot/Manual, "+ Thêm thư mục kênh…", "+ Tạo kênh mới…", "Quản lý tất cả kênh…" (hộp quản lý kênh của 047), "Cài đặt kênh…".
- FR-AP-14: Ghi nhật ký phiên con (`recordSessions` bọc runtime agent; D3 5.16 `videos/<vd>/sessions/`). IPC `sessions.list` (chat chính, phiên con, phiên cũ chỉ còn trace), `sessions.get` (dòng nhật ký; phiên chỉ có trace → danh sách tool). Sidebar: vài phiên gần nhất; "Xem tất cả" → hộp lịch sử phiên (lọc video/loại, nhóm theo ngày, xem nội dung chỉ đọc).
- FR-UI-48-03: Explorer chuyển vào hộp "Chi tiết kênh" (cuối sidebar), có nút mở thư mục trong Windows.

## AC
- `session-recorder.test.ts`: phiên frame được ghi (đầu phiên, lời nhắn, chữ, tool + kết quả, kết thúc + token); phiên main không ghi trùng.
- `host.test.ts`: `sessions.list/get` đủ 3 nguồn.
- `session-format.test.ts`: nhãn, nhóm theo ngày, thời lượng, lọc.
- UI: vào thẳng kênh; Chi tiết kênh → explorer; lịch sử phiên xem lại chat vừa gửi; bộ chọn kênh hiện Autopilot sau khi bật.
