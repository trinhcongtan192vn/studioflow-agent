# Implementation Plan: Agent Runtime Claude

**Branch**: `005-agent-runtime-claude` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

## Summary
`packages/core/src/agent/`: `policy.ts` (D5 mục 4 built-in + tool Gateway, `canUseTool`), `system-append.ts` (FN-005), `events.ts` (thông điệp SDK → `AgentEvent`, thuần), `claude.ts` (`ClaudeAgentRuntime` trên `@anthropic-ai/claude-agent-sdk`), `replay.ts` (ghi/phát lại theo `SF_LLM`), `index.ts` (`createRuntime()` chọn theo `SF_LLM`); plugin `extensions/studioflow-core`; CLI `sf agent auth|ask`.

## Technical Context
**Language**: TypeScript 5 / Node 22 · **Dependencies**: `@anthropic-ai/claude-agent-sdk` 0.3.x (gói kèm CLI native win32-x64) · **Testing**: Vitest — unit (policy, events, canUseTool), integration replay (bản ghi trong `tests/fixtures/llm/agent/`), test thật gắn nhãn `live` chỉ chạy khi `SF_LLM=record` · **Constraints**: không đọc cấu hình người dùng; không ghi bí mật.

## Constitution Check
- [x] I · [x] II/III (`packages/core/src/agent`, CLI `sf agent`) · [x] IV · [x] V (`AgentRuntime`… trích từ D5) · [x] VI (agent chỉ ghi qua MCP `sf`; tool ghi/lệnh của runtime bị tắt + `canUseTool`) · [x] VII (sự kiện tool_call/usage; span ở 015) · [x] VIII · [x] IX (Agent Runtime Port là ranh giới đã định) · [x] X (LLM chỉ giả lập bằng ghi/phát lại).

## Project Structure
```text
extensions/studioflow-core/.claude-plugin/plugin.json
extensions/studioflow-core/skills/studioflow/SKILL.md
packages/core/src/agent/{policy,system-append,events,claude,replay,index}.ts
packages/core/src/modules/agent/cli.ts
packages/core/tests/fixtures/llm/agent/*.json
```

## Complexity Tracking
Không có vi phạm.
