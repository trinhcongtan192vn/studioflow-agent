# Research — 008

## R1. Vị trí hợp đồng IPC
- D10 ghi `packages/core/ipc/schema.ts`; đặt `packages/core/src/ipc/schema.ts` (rootDir `src` của core) và export từ `@studioflow/core`.

## R2. Tiến trình core
- `utilityProcess.fork(require.resolve('@studioflow/core/host-entry'))` — entry chưa bundle để đường dẫn `extensions/`, `workers/` của core đúng khi chạy dev. Đóng gói (installer) cần chép `packages/core/dist` + phụ thuộc và đặt `SF_EXTENSIONS_DIR`/`SF_WORKER_SRC` — việc của bản cài sau M1 nội bộ.
- Electron 37 (Node 22) chạy `node:sqlite` trong utilityProcess.

## R3. Bí mật
- Tech-defaults gợi ý `@napi-rs/keyring` trong `main`; dùng module Credential Manager của 014 (PowerShell P/Invoke, không native) gọi từ `main`; `main` gửi `{type:'secrets'}` cho core khi khởi động và khi đổi khóa; core không tự đọc (`setHostSecrets`).

## R4. Chat log và tiếp tục phiên
- `chat/<session_id>.jsonl` (D3 5.16) ghi nối đuôi qua `WriteStore.appendLine`; id phiên SDK lưu thành dòng `system` `sdk_session:<id>` (ẩn khi hiển thị) → mở lại video truyền `resume`.

## R5. Span khi phát lại
- `RecordReplayRuntime` tạo `sf.agent.session` (thuộc tính `sf.replay`) với token từ sự kiện đã ghi để trace hiển thị như khi chạy thật.
