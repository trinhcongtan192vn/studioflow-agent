# 081 — Agent tạo video mới từ chat kênh

## Vấn đề
Tan (2026-10-08): ở chat kênh, nhờ "dựng short từ video …" thì agent trả lời "Bạn cần … tạo một video mới trong kênh … hoặc mở phiên chat từ trong video đó. Sau đó nhắn 'đã mở'" — agent không có cách tạo video, người dùng phải tự làm rồi nhắn lại.

## Yêu cầu
- FR-CH-81-01 Tool Gateway `video.create {title, instruction}` (phiên `main`, chỉ khi chưa ở trong video; trong video → `E_SCHEMA_INVALID`): tạo video (`phase: briefing`), trả `{video_id, note}`; core phát `videoEvents` `created`.
- FR-CH-81-02 Host: sự kiện IPC `video.created {channel, video, title}`; khi lượt chat kênh kết thúc, gửi `[Từ chat kênh] <instruction>` vào phiên chat của video mới (vai `user`) để agent của video làm tiếp. Khóa kênh theo `canonicalDir` (đường dẫn ngắn 8.3).
- FR-UI-81-03 App nhận `video.created` của kênh đang mở → làm mới danh sách, mở video đó, thông báo nổi.
- Skill `studioflow`: chat kênh mà người dùng muốn làm video → `video.create`, không bảo người dùng tự tạo.
- D4 bảng tool: thêm `video.create`.

## AC
- `host.test.ts`: agent (giả) gọi `video.create` ở chat kênh → video có trong danh sách với đúng tên, có `video.created`, lịch sử chat của video có tin `[Từ chat kênh] …` (vai user); gọi trong phiên video → lỗi.
