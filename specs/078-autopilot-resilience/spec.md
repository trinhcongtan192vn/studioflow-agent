# 078 — Autopilot chịu lỗi tạm thời; nền tảng chưa kết nối không gây nhiễu

## Vấn đề (rà soát luồng Autopilot, 2026-10-08)
- Mọi lỗi chỉ chạy lại 1 lần rồi mục kế hoạch thành `failed` vĩnh viễn. Lỗi chung tạm thời (mất mạng, Claude quá tải, Claude cần đăng nhập lại) lan dây chuyền: mọi mục trong ngày đều hỏng.
- Nền tảng chưa kết nối (Nuvora đặt YouTube + TikTok + Facebook): cảnh báo "chưa kết nối" gửi lại sau mỗi lần mở app (nhớ trong bộ nhớ); màn Đăng hiện "Chờ tải lên" thay vì lý do; video đã công khai trên YouTube vẫn nằm ở "Chờ đăng" mãi.

## Yêu cầu
- FR-AP-78-01 `outageOf(code, msg)`: `auth` (E_AUTH_REQUIRED, "not logged in", "/login", "invalid api key", "OAuth token has expired") → chờ 60 phút; `overloaded` (overloaded/529/503) → 10 phút; `network` (fetch failed, ENOTFOUND, ECONNRESET, ETIMEDOUT…, trừ kết nối tới 127.0.0.1/localhost) → 15 phút. Lỗi riêng của bước → không.
- FR-AP-78-02 Bước (và giao brief) lỗi chung: lỗi mới → tạm dừng cả Autopilot (`waiting_until`, `waiting_reason`), nhật ký `outage.wait` (tiếng Việt; đăng nhập → nhắc đăng nhập lại); hết giờ → `outage.resume`, chạy lại đúng bước, không tính lần chạy lại, mục giữ `in_production`; tối đa 8 lần chờ mỗi bước rồi xử lý như lỗi thường.
- FR-UI-78-03 Trạng thái Autopilot (app, Telegram) hiện đúng lý do chờ.
- FR-PB-78-04 Chưa kết nối nền tảng: báo một lần khi trạng thái đổi (lưu trong kế hoạch); màn Đăng hiện lý do; không giữ video ở "Chờ đăng".

## AC
- `autopilot-outage.test.ts`: phân loại + thời gian chờ; lỗi bước, ComfyUI cục bộ, GPU OOM không tính.
- `autopilot-runner.test.ts`: mất mạng → chờ 15 phút → làm tiếp đúng bước, không `step.retry`; cần đăng nhập → chờ 1 giờ, mục sau không bị đụng.
- `publish-queue.test.ts`, `publish-format.test.ts`: chưa kết nối.
