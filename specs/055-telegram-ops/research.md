# 055 — Quyết định kỹ thuật

## R1. HTML thay vì MarkdownV2 cho tin của app
MarkdownV2 đòi escape 19 ký tự, dễ lỗi với tiêu đề video/ghi chú tiếng Việt chứa `.`, `-`, `(`. HTML chỉ cần `& < >`. Có cả `escapeMarkdownV2` (yêu cầu) và kiểm thử, nhưng không dùng mặc định. Tin của agent là văn bản thuần: LLM sinh markdown tùy ý, một dấu `_` lẻ là Telegram từ chối cả tin. Chia tin theo dòng (≤ 4096 ký tự thô, mọi thẻ HTML của app nằm gọn trong một dòng nên không gãy thẻ).

## R2. `SecretStore` bất đồng bộ, cầu thông điệp thay vì ảnh chụp bí mật
Cơ chế cũ (052): `main` đọc hết `SECRET_NAMES` rồi đẩy ảnh chụp đồng bộ vào core. Không dùng được cho bí mật động (`oauth:youtube:<channel_id>`) và cho **ghi** (refresh token mới). Cổng mới là Promise; core hỏi `main` khi cần (`secret.get`), `main` là nơi duy nhất chạm Credential Manager (D5 5.4). Giữ ảnh chụp cũ cho khóa provider để không đổi 009/044/049. Hết hạn 15 s → `E_PROVIDER_UNAVAILABLE`. Tên bí mật kiểm ở ba nơi (core store, bridge của main, `credTarget`) vì tên đi vào script PowerShell. Không thêm mã lỗi mới: tái dùng `E_PROVIDER_UNAVAILABLE` / `E_PROVIDER_FAILED` / `E_SCHEMA_INVALID`.

## R3. Phiên `ops` không gắn kênh → tham số `channel` do Gateway giải
`ToolContext.store` luôn từ `SessionContext.channel_dir`. Cho phiên ops, `channel_dir` = thư mục dữ liệu app và tool vận hành khai thêm `channel` (`OPS_CHANNEL_PROP`); Gateway giải tên/đường dẫn qua `channelResolver` (kênh Autopilot đang bật) thành kho ghi của kênh, nên **handler tool cũ không đổi** (`autopilot.plan_get/update`, `research.get`, `autopilot.status`). Phiên không phải ops dùng `channel` → `E_SCHEMA_INVALID` (tránh tham số "ma"). `autopilot.status` được bỏ trống `channel` (tóm tắt mọi kênh). Quyền ghi của ops chỉ gồm `autopilot.plan_update` / `pause` / `resume`; `plan_update` giữ nguyên luật 051 (không sửa mục đang/đã làm).

## R4. Vòng nhận tin
Quyết định gửi trả lời "im lặng" cho người lạ: trong nhóm có bot, người ngoài không nên biết bot phản hồi. Người dùng có danh sách cho phép vẫn phải đúng nhóm hoặc nhắn riêng. Privacy mode mặc định của bot trong nhóm (chỉ thấy lệnh, nhắc tên, trả lời): vì vậy chỉ ba cách gọi; tin thường bị bỏ qua mà không cần cấu hình thêm với BotFather. Một câu hỏi một lúc mỗi chat (tránh hai lượt agent chạy chồng trên cùng phiên).

## R5. Thông báo từ nhật ký vận hành
Bộ chạy đã ghi mọi quyết định vào nhật ký với thông điệp tiếng Việt; thông báo dùng lại đúng thông điệp đó (không soạn hai lần) qua `Notifier` ở chỗ ghi nhật ký duy nhất (`runner.log`). Bộ thông báo tự lọc loại sự kiện, nên 053/054 gửi sự kiện riêng qua cùng cổng. `TelegramNotifier` xếp hàng tuần tự để giữ thứ tự tin.

## R6. Test không chạm mạng
`fetch` tiêm ở `CoreHost` (`telegramFetch`, `telegramSleep`); `getUpdates` giả chờ 15 ms khi hết hàng đợi để vòng lặp không quay vòng. Runtime agent là giả (ghi `SessionOptions`, trả lời có tool call thật qua Gateway) nên kiểm cả chính sách tool lẫn nhật ký phiên.
