# 050 — Research / quyết định

## R1. Đo thời gian bằng span bước, không bằng đồng hồ tường
Span `sf.workflow.step` kết thúc khi bước sang `waiting_approval` (engine `finishStep`), nên tổng thời lượng span không chứa thời gian chờ người duyệt. Đồng hồ tường giữa bước đầu và bước cuối sẽ chứa cả đêm chờ duyệt → loại. Hạn chế: bước agent chờ người trả lời trong chat (`waitComplete`) vẫn nằm trong span; trung vị K = 5 làm giảm ảnh hưởng, và ở chế độ Autopilot không có người trả lời.

## R2. `sf.step_outcome` trên span bước
Gate trượt không ném lỗi (`runStepInner` trả `false`) nên span vẫn `ok`. Thêm thuộc tính `sf.step_outcome` (trạng thái bước khi span kết thúc) để bỏ lần chạy gate trượt; D11 cập nhật. Span cũ không có thuộc tính → coi như được tính. Bước `skipped` vẫn tính (thời lượng ≈ 0 là đúng thực tế), tránh coi bước luôn bị bỏ qua là "thiếu lịch sử".

## R3. Mẫu: lần chạy mới nhất mỗi video, K video gần nhất mỗi bước
Chọn theo từng bước (không đòi video "xong trọn") để workflow mới chạy được vài bước đã có số đo. Lần chạy lại (sửa yêu cầu) chỉ lấy lần mới nhất của video đó. Thời gian thử lại/gate trượt không cộng vào — biên an toàn 0,8 bù phần này.

## R4. Token mỗi video chỉ từ video đã xong bước cuối
Video dở dang có token chưa đủ → kéo trung vị xuống. Token gồm cả chat tay của video (Manual) → ước tính hơi cao, an toàn.

## R5. Học ngân sách ngày
Gói Claude giới hạn theo phiên 5 giờ và theo tuần, không công bố số token. Lấy lần chạm hạn mức gần nhất T: tổng token Claude (bảng `usage`, `provider = claude`, mọi việc) trong 7 ngày trước T ÷ 7. Nhận diện bằng thông báo "hit your … limit" / "usage limit reached" trong `status_message` hoặc `sf.error` của span — không dùng mã `E_RUNTIME_RATE_LIMIT` vì mã này gồm cả 429/overloaded tạm thời. Chạm hạn mức phiên 5 giờ cũng được tính (ước tính thấp hơn → an toàn). Người dùng ghi đè bằng `autopilot.daily_tokens`.

## R6. "Đầu ngày làm việc" và múi giờ
Dùng `publish.timezone` tầng app (người dùng đã khai, mặc định `Asia/Ho_Chi_Minh`) thay cho múi giờ hệ điều hành để test xác định và khớp lịch đăng. Khung qua đêm: đang trong khung → còn đến giờ kết thúc (có thể sang ngày sau); khung hôm nay chưa bắt đầu → cả khung; đã hết → 0. Token "hôm nay" đếm từ giờ bắt đầu khung hiện tại (trong khung) hoặc nửa đêm (ngoài khung). Không xử lý riêng DST (múi giờ mặc định không có DST; sai lệch tối đa 1 giờ hai lần mỗi năm).

## R7. Làm tuần tự, chi phí kênh = trung bình workflow được phép
Một máy, một GPU: giả định video làm nối tiếp (bảo thủ; bước LLM và GPU của hai video có thể chồng nhau, số thật có thể cao hơn). Chưa biết 051 chọn workflow nào cho kênh → lấy trung bình các workflow được phép; 051 có thể gọi `capacityToday` với `workflows` một phần tử để tính chính xác. Chia vòng tròn theo thứ tự kênh để không kênh nào chiếm hết quỹ.

## R8. Yếu tố giới hạn
Mọi kênh chạm trần → `cap`; ngược lại yếu tố đầu tiên theo thứ tự `time`, `tokens`, `uploads` chặn một kênh chưa chạm trần. Thứ tự này ưu tiên tài nguyên người dùng chỉnh được nhanh nhất (khung giờ) khi nhiều yếu tố cùng chặn.

## R9. Hạn mức YouTube là hằng số
10 000 đơn vị/ngày/dự án, 1 600 mỗi lượt đăng (tài liệu YouTube Data API v3) → 6 lượt. Chung cho mọi kênh vì app dùng một OAuth client. Quét đối thủ (049, `search.list` 100 đơn vị) cũng ăn vào hạn mức → tham số `youtube_units_used_today`.

## R10. Video đang làm dở
IPC trừ vào quỹ phần việc còn lại (`remainingWork`) của video thuộc kênh Autopilot đang có bước `running`. Video đang chờ duyệt / lỗi không trừ (không chạy cho tới khi có người can thiệp).

## Lệch so với gợi ý
- Đề bài gợi ý "jobs already queued/running reduce available time": dùng trạng thái bước của video thay vì bảng `jobs`, vì job không có ước tính thời lượng còn lại còn bước thì có trung vị (R10).
