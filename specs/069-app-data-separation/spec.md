# 069 — Dữ liệu app riêng, độc lập với app StudioFlow cũ

## Vấn đề
App dùng `%APPDATA%\StudioFlow` (productName "StudioFlow") và khóa `StudioFlow/<tên>` trong Credential Manager — trùng tên với app StudioFlow cũ (`E:\VideCode\StudioFlow`, gói `studioflow`; Windows không phân biệt hoa thường). Tan (2026-10-08): hai app hoàn toàn độc lập; app cũ sẽ bị xóa.

## Yêu cầu
- FR-OP-69-01 Thư mục dữ liệu `%APPDATA%\StudioFlow Agent` (Electron `userData` = app-data của core); `SF_APP_DATA` vẫn ưu tiên. productName "StudioFlow Agent".
- FR-OP-69-02 Chuyển một lần: thư mục mới chưa có và `%APPDATA%\StudioFlow\settings.json` là của app này (`schema_version: 1` + `config`/`installed`/kênh) → đổi tên thư mục (cùng ổ, tức thì; venv Python trỏ Python hệ thống, `extra_model_paths.yaml` sinh lại mỗi lần chạy). Không đổi được → dùng tạm thư mục cũ lần này. Thư mục không phải của app → để nguyên.
- FR-OP-69-03 Bí mật `StudioFlow Agent/<tên>`; chưa có → đọc `StudioFlow/<tên>` rồi chép sang (không xóa tên cũ); xóa bí mật → xóa cả hai.

## AC
- `app-data.test.ts`: SF_APP_DATA; cài mới; chuyển thư mục của app; bỏ qua thư mục lạ; không đổi được → thư mục cũ.
- `secret-store.test.ts`: tên mới + tên cũ.
- Máy Tan: sau khi chạy, `%APPDATA%\StudioFlow Agent` có model/cài đặt; 4 bí mật đọc được.
