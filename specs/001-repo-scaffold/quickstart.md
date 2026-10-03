# Quickstart — 001 repo-scaffold

## Yêu cầu
Windows 11 x64; Node ≥ 22; Python ≥ 3.11; `uv` ≥ 0.4; Git. (GPU không bắt buộc.)

## Thiết lập
```powershell
git clone <repo> ; cd studioflow-agent
npm run setup      # doctor → npm install → uv sync → bật git hooks
```
`npm run setup` báo rõ công cụ thiếu và phiên bản tối thiểu (FR-006).

## Kiểm tra tổng (Story 1)
```powershell
npm run verify     # build + lint + test 3 project, báo cáo theo project, exit 0 khi xanh
```

## CLI (Story 2)
```powershell
npx sf --version
npx sf --help
npx sf diag echo --message hi --repeat 2        # exit 0
'{"message":"hi"}' | npx sf diag echo --json    # exit 0
npx sf diag echo                                # exit 2, stderr {code,message}
npx sf diag fail                                # exit 1
```

## Từng project (Story 3)
```powershell
npm run dev -w apps/desktop                     # cửa sổ hiện "core <version>"
cd workers/gpu ; uv run python -m sf_worker selftest   # {"status":"ready",...}
```

## Test theo loại (Story 5)
```powershell
npx sf test contract     # hoặc integration | e2e | unit | ui | gpu
$env:SF_GPU="0"; npx sf test gpu   # gpu báo skipped
```

## Đóng gói (Story 4)
```powershell
npm run package          # chạy verify trước; xanh mới build → release/StudioFlow-Setup-<version>.exe
```
Bản cài **không ký số mã** (chỉ nội bộ M0/M1): Windows SmartScreen có thể cảnh báo "Windows protected your PC" → *More info* → *Run anyway*. Gỡ cài đặt xóa thư mục chương trình, giữ `%APPDATA%\StudioFlow`.

## Truy vết (Story 6)
Commit message phải chứa số tính năng 3 chữ số, ví dụ `feat(core): ... (001 FR-008)`. Hook `commit-msg` chặn nếu thiếu.
