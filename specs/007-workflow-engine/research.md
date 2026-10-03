# Research — 007

## R1. Semver
- **Decision**: hàm nhỏ `satisfies(version, range)` hỗ trợ so sánh `>=,>,<=,<,=`, `^`, `~`, nhiều điều kiện cách nhau bằng khoảng trắng (AND) và `||`. Đủ cho `app_api` của D13; tránh thêm phụ thuộc.

## R2. Thứ tự dữ liệu (`E_STEP_ORDER`)
- **Decision**: mỗi bước trong thư viện có tập token Đọc/Ghi (`SCRIPT.md`, `STORYBOARD.md`, `audio`, `lipsync`, `frames`, …) theo D6 mục 2; bước A đọc token mà chỉ bước sau A (theo thứ tự thực thi suy từ `after`) ghi → `E_STEP_ORDER`. Token chưa ai ghi trong workflow (đầu vào từ ngoài, ví dụ hồ sơ kênh) không báo lỗi.

## R3. Bước agent
- **Decision**: `AgentStepRunner(instruction, ctx) → Promise<void>`; engine tạo `Promise` chờ `workflow.step_complete` của bước đó; runner trả về mà bước chưa báo xong → `E_STEP_INCOMPLETE`. 008 cài runner bằng phiên `main` (D5) — 007 test bằng runner giả gọi `stepComplete`.

## R4. Approval mất hiệu lực
- **Decision**: kiểm khi đọc trạng thái (`summary()`), trước khi chạy tiếp (`advance()`), và ở gate `approved`; so `sha256` file hiện tại với `artifact_hashes`.

## R5. Khôi phục
- **Decision**: `WorkflowEngine.open()` (gọi khi mở video): bước engine `running` → `pending` rồi chạy lại khi `advance()` (executor idempotent nhờ graph + cache); bước agent `running` → `pending` + `error: {code: 'E_STEP_INCOMPLETE', message: 'app closed; confirm to run again'}`.
