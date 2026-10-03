# Implementation Plan: Desktop shell + chat

**Branch**: `008-desktop-shell-chat` | **Spec**: [spec.md](spec.md)

## Summary
Core: `ipc/schema.ts`, `host/host.ts` (`CoreHost`: một `createCore`, runtime agent, phiên `main` theo video, chat log, explorer, thẻ duyệt, các phương thức D10), `host/main.ts` (entry utilityProcess, export `@studioflow/core/host-entry`), `WriteStore.appendLine`, `setHostSecrets`, `ClaudeSession.sdkSessionId`. Desktop: `main` (utilityProcess + MessageChannelMain, hộp thoại, Credential Manager, khởi động lại), `preload` (chuyển port), renderer `rpc.ts`, `App`, `Home`, `Onboarding`, `Workspace`, `Chat`, `Tabs`, `Settings`, `styles.css`.

## Constitution Check
- [x] I (logic ở core; UI chỉ gọi IPC) · [x] II · [x] IV · [x] V (IPC theo D10; kiểu từ hợp đồng) · [x] VI (UI không ghi project; upload qua `importFile`) · [x] VII · [x] VIII (3 project giữ nguyên) · [x] IX · [x] X (test UI thật, LLM ghi/phát lại).

## Complexity Tracking
Không có vi phạm.
