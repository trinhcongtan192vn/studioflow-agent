# FN-050 — Mô hình năng lực Autopilot (ước tính số video làm được hôm nay)

> Ghi chú tính năng (gợi ý, không ràng buộc — CLAUDE.md quy tắc 6). Phục vụ FR-AP-05 (PRD 8.13). Bộ lập kế hoạch ngày (051) dùng kết quả này.

## 1. Đầu vào

| Nguồn | Dùng để |
|---|---|
| Span `sf.workflow.step` (bảng `spans`, D11) | Thời gian từng bước trên máy này |
| Bảng `usage` (D11 mục 3), dòng `kind = llm`, `provider = claude` | Token Claude mỗi video; token đã dùng hôm nay; học ngân sách ngày |
| Span có thông báo chạm hạn mức Claude (`status_message` hoặc thuộc tính `sf.error`, ví dụ "You've hit your weekly limit · resets 3am") | Mốc học ngân sách ngày |
| `autopilot.work_window`, `autopilot.budget_share`, `autopilot.daily_tokens`, `publish.timezone` (tầng app) | Khung giờ, tỉ lệ ngân sách, ghi đè ngân sách, múi giờ |
| `autopilot.workflows`, `autopilot.max_per_day`, `publish.platforms` (tầng kênh) | Workflow được dùng, trần mỗi kênh, kênh có đăng YouTube không |

## 2. Thời gian sản xuất mỗi video

- Chỉ đo **thời lượng span của từng bước** (`end_ms − start_ms`), không đo thời gian giữa hai bước → thời gian chờ người duyệt không làm phình ước tính (span bước kết thúc khi bước sang `waiting_approval`).
- Bỏ span lỗi (`status = error`) và span có `sf.step_outcome = failed` (gate trượt). Span của bước bị ngắt (tắt app giữa chừng) không bao giờ kết thúc nên không có trong bảng.
- Mỗi (workflow, bước): lấy lần chạy được tính **mới nhất** của mỗi video, chọn **K = 5** video gần nhất, lấy **trung vị**. Tổng trung vị các bước của manifest = ước tính mỗi video.
- `samples` = số video ít nhất trong các bước (độ tin cậy); `samples < 3` → độ tin cậy thấp.
- Bước của manifest chưa có lịch sử → cộng phần mặc định tương ứng (mặc định workflow × số bước thiếu / tổng số bước). Workflow chưa chạy lần nào → dùng hẳn mặc định dưới đây, đánh dấu độ tin cậy thấp.

### Mặc định khi chưa có lịch sử (ước lượng thô, máy tham chiếu)

| Workflow | Thời gian / video | Token Claude / video |
|---|---|---|
| `narrated-explainer` | 90 phút | 600 000 |
| `story-documentary` | 180 phút | 800 000 |
| `essay-audiobook` | 60 phút | 400 000 |
| `shorts` | 30 phút | 200 000 |
| `short-film` | 240 phút | 1 000 000 |
| workflow khác | 120 phút | 800 000 |

## 3. Token Claude

- Token mỗi video = tổng `input_tokens + output_tokens` các dòng `usage` Claude của video; trung vị trên K video **đã xong bước cuối** gần nhất của workflow; không có → mặc định bảng trên.
- Ngân sách ngày:
  1. `autopilot.daily_tokens` nếu đặt (số dương).
  2. Không đặt → **học**: lần chạm hạn mức gần nhất tại thời điểm T → tổng token Claude trong `[T − 7 ngày, T]` ÷ 7.
  3. Chưa chạm hạn mức lần nào → **chưa biết**: token không giới hạn số video, lý do ghi rõ.
- Token còn cho Autopilot hôm nay = ngân sách ngày × `autopilot.budget_share` − token Claude đã dùng từ đầu ngày làm việc − token còn cần của video đang làm dở. Phần còn lại (mặc định 30%) để dành cho làm tay qua chat.

## 4. Thời gian còn trong ngày

- Giờ địa phương theo `publish.timezone` tầng app (mặc định `Asia/Ho_Chi_Minh`).
- Đang trong khung → còn đến giờ kết thúc khung (khung qua đêm `22:00-06:00` lúc 02:00 → còn 4 giờ). Khung hôm nay chưa bắt đầu → cả khung. Khung đã hết → 0.
- "Đầu ngày làm việc" (để tính token đã dùng) = giờ bắt đầu khung hiện tại nếu đang trong khung, ngược lại nửa đêm địa phương.
- Quỹ thời gian = thời gian còn × **0,8** (biên an toàn: thử lại, gate trượt, máy bận việc khác) − thời gian còn lại của video đang làm dở.
- Video làm **tuần tự** (một GPU) — ước tính bảo thủ.

## 5. Hạn mức đăng YouTube

- Một dự án Google: 10 000 đơn vị/ngày, mỗi lượt đăng ≈ 1 600 đơn vị → **6 lượt/ngày**, chung cho mọi kênh dùng cùng dự án. Đơn vị đã dùng hôm nay (quét đối thủ 049, đăng 053) trừ vào hạn mức; trước 053 chưa có nguồn ghi → 0.
- Chỉ video của kênh có `youtube` trong `publish.platforms` tốn lượt đăng.

## 6. Phân bổ cho từng kênh

- Mỗi kênh: chi phí một video = trung bình ước tính (thời gian, token) các workflow được phép (`autopilot.workflows`, rỗng = mọi workflow cài sẵn); trần = `autopilot.max_per_day` − số video đã tạo hôm nay.
- Chia vòng tròn theo thứ tự kênh: mỗi vòng mỗi kênh còn trần nhận một video nếu còn đủ thời gian, token, lượt đăng.
- `limiting_factor`: mọi kênh chạm trần → `cap`; ngược lại yếu tố đầu tiên (thứ tự `time`, `tokens`, `uploads`) chặn kênh chưa chạm trần.
- Bộ lập kế hoạch (051) gọi lõi thuần `capacityToday` với danh sách kênh của nó; IPC `autopilot.capacity` dùng các kênh quản lý đang bật Autopilot.
