# Data model — 001 repo-scaffold

Không có artifact miền (thuộc 002). Chỉ các cấu trúc của khung.

## CliCommand (packages/core/src/cli)

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `module` | string `^[a-z][a-z0-9-]*$` | tên thư mục module |
| `name` | string `^[a-z][a-z0-9-]*$` | tên lệnh |
| `summary` | string | hiện trong `sf --help` |
| `options` | `parseArgs` options | tham số dòng lệnh |
| `positionals` | string[] | tên tham số vị trí |
| `run(input, ctx)` | `Promise<unknown>` | trả giá trị → JSON stdout; ném `CliError` |

Bất biến: cặp `(module, name)` duy nhất — trùng thì khung báo `E_CLI_DUPLICATE_COMMAND` (mã thoát 1) khi khởi động.

## CliError

`{ code: string, message: string, exit: 1 | 2 }`. Mã của khung:

| Mã | Exit | Nghĩa |
|---|---|---|
| `E_CLI_USAGE` | 2 | tham số thiếu/sai, lệnh không tồn tại |
| `E_CLI_BAD_JSON` | 2 | stdin không phải JSON hoặc vượt 1 MB |
| `E_CLI_DUPLICATE_COMMAND` | 1 | hai module đăng ký trùng lệnh |
| `E_INTERNAL` | 1 | lỗi không lường trước |
| `E_DIAG_FAIL` | 1 | lỗi nghiệp vụ mẫu của `sf diag fail` |

Các mã `E_CLI_*` sẽ được gộp vào `docs/contracts/errors.json` ở 002.

## Test type

Enum `contract | integration | e2e | gpu | ui | unit`.

## VerifyReport

Xem [contracts/verify-report.md](contracts/verify-report.md).
