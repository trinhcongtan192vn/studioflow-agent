# Research — 001 repo-scaffold

Theo `docs/tech-defaults.md` mục 6 trừ khi ghi lệch.

## R1. Trình quản lý gói TS
- **Decision**: npm workspaces (npm 10, đi kèm Node 22).
- **Rationale**: có sẵn trên máy, không cần corepack; 2 workspace TS là đủ nhỏ. tech-defaults không chỉ định.
- **Alternatives**: pnpm (nhanh hơn, nhưng thêm bước cài và symlink gây rắc rối với electron-builder trên Windows).

## R2. Build desktop
- **Decision**: electron-vite (main/preload/renderer) + React 18; đóng gói electron-builder NSIS x64 (tech-defaults).
- **Rationale**: một cấu hình cho 3 tiến trình Electron, HMR khi dev.
- **Ghi chú lệch**: tech-defaults mục 1 đặt `core` trong `utilityProcess` với JSON-RPC qua `MessagePort`. 001 chưa có `core` chạy dài; main gọi trực tiếp `getVersion()` của `@studioflow/core` và chuyển qua IPC preload. Chuyển sang `utilityProcess` thuộc 008 (desktop-shell-chat).

## R3. Khung CLI
- **Decision**: tự viết trên `node:util.parseArgs`; registry phát hiện module bằng cách quét `modules/*/cli.{js,ts}` cạnh khung (import động).
- **Rationale**: quy ước D4 mục 12 (JSON stdin, `{code, message}`, mã 0/1/2) không khớp sẵn với commander/yargs; phát hiện bằng thư mục đáp ứng FR-010/SC-006 (thêm module không sửa khung).
- **Alternatives**: commander (phải bọc lại toàn bộ xử lý lỗi/mã thoát — trái Điều IX).

## R4. Ranh giới desktop → core
- **Decision**: `@studioflow/core` khai báo `exports` chỉ `"."` và `"./cli"`; ESLint `no-restricted-imports` cấm `@studioflow/core/*` khác và đường dẫn tương đối vào `packages/`.
- **Rationale**: chặn cả lúc lint (FR-SC-002b) lẫn lúc resolve.

## R5. Loại test
- **Decision**: thư mục `tests/<loại>/` trong mỗi project; Vitest `--project`/đường dẫn, pytest marker. Nhãn `gpu`: TS dùng `describeGpu` (bọc `describe.skipIf(SF_GPU==='0')`), Python dùng `@pytest.mark.gpu` + `conftest.py` skip khi `SF_GPU=0`. Báo cáo hiển thị "skipped".
- **LLM**: `packages/core/src/testing/llm-replay.ts` — khóa = sha256 của yêu cầu chuẩn hóa; `replay` thiếu bản ghi → ném `E_LLM_FIXTURE_MISSING`; `record` gọi hàm thật rồi ghi. Mặc định `replay` khi biến không đặt.

## R6. Độ phủ
- **Decision**: v8 coverage, ngưỡng dòng 80% cho `packages/core/src` (tech-defaults), áp trong `verify` và CI.

## R7. Truy vết commit
- **Decision**: `.githooks/commit-msg` (bật bằng `git config core.hooksPath .githooks` trong `npm run setup`) + bước CI kiểm mọi commit của PR. Quy tắc: tiêu đề chứa số 3 chữ số `\b\d{3}\b`; merge commit được miễn.

## R8. Đóng gói
- **Decision**: chỉ vỏ app + `core` (Clarifications 2026-10-03). Không ký số; `quickstart.md` ghi rủi ro SmartScreen. Uninstall NSIS mặc định không xóa `%APPDATA%` (`deleteAppDataOnUninstall: false`).

## R9. Python
- **Decision**: `uv` project ở `workers/gpu`, `requires-python >=3.11`, dev deps pytest + ruff; lệnh `uv run python -m sf_worker selftest` in JSON `{status, python, gpu}`; không cần torch ở 001 (phát hiện GPU qua `nvidia-smi` nếu có, lỗi thì `gpu:false`).
