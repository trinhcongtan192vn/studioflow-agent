# 076 — Ngân sách Autopilot: không chặn kế hoạch, không đỗ video vì chi phí danh nghĩa

## Vấn đề (rà soát luồng Autopilot, 2026-10-08)
- Kế hoạch 07/10 kênh Nuvora: 0 video — "giới hạn bởi ngân sách Claude" (~161k token/ngày, ước 200k/video khi chưa có lịch sử). Ngân sách học từ lần chạm hạn mức = tổng 7 ngày ÷ 7 cho cả hạn mức phiên 5 giờ (ước quá thấp khi app mới dùng vài ngày); kế hoạch chỉ lập một lần mỗi ngày nên 0 là 0 cả ngày; không có chỗ đặt tay `autopilot.daily_tokens`.
- `text.claude` cộng `total_cost_usd` (giá quy đổi của gói Claude, không phải tiền thật) vào `budget.api_cost_usd` của video → video dài vượt `budget.api_cost_usd_per_video` ($5; vd_9igps62m $5.10) → bước chữ sau đó hỏi "API có phí" → video Autopilot bị đỗ.

## Yêu cầu
- FR-AP-76-01 Học ngân sách theo loại hạn mức chạm gần nhất: tuần → 7 ngày ÷ 7; phiên 5 giờ → token 5 giờ trước mốc × (khung giờ làm việc ÷ 5 giờ, ≥ 1). `readLimitHits` trả `{ts_ms, weekly}`.
- FR-AP-76-02 Kế hoạch hôm nay hết mục chờ làm → bộ chạy lập bổ sung (`planToday` giữ mục cũ), tối đa mỗi giờ một lần.
- FR-AP-76-03 `text.claude` chỉ tính tiền khi dùng khóa API Anthropic; gói Claude → `cost_usd = 0` (chỉ giới hạn bằng token).
- FR-UI-76-04 Cài đặt → Autopilot: ô "Ngân sách Claude mỗi ngày (token)" (trống = tự học) + dòng "Đang dùng ≈ … token/ngày (đặt tay/tự học) · hôm nay làm được N video" (`autopilot.capacity`).

## Ghi chú
Hạn mức tuần dùng chung với mọi việc khác của tài khoản Claude, nên số học được từ hạn mức tuần chỉ là phần app đã dùng — ô đặt tay để người dùng chỉnh.

## AC
- `autopilot-capacity.test.ts`: tuần ÷ 7; phiên × số phiên của khung giờ.
- `autopilot-runner.test.ts`: sau 1 giờ lập bổ sung, chưa đủ 1 giờ thì không.
- `claude-text-limit.test.ts`: không khóa → 0 $, có khóa → giá SDK.
- UI test: ô ngân sách hiện trong Cài đặt.
