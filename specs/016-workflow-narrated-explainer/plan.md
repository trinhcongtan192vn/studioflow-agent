# Implementation Plan: narrated-explainer

**Branch**: `016-workflow-narrated-explainer` | **Spec**: [spec.md](spec.md)

## Summary
`extensions/workflows/narrated-explainer/{workflow.yaml,.claude-plugin/plugin.json,skills/narrated-explainer/SKILL.md}`; `packages/core/src/workflow/finalize.ts` (executor `captions`, `finalize`, objective `duration`); gate `duration` thêm vào bước `finalize` của thư viện bước (bảng D6 mục 2). Test: `narrated-explainer.test.ts` (tất định), `m1-acceptance.test.ts` (thật, opt-in).

## Constitution Check
- [x] I–X; V: manifest theo `WorkflowManifest` D6; X: E2E dùng HyperFrames/FFmpeg thật, chỉ LLM/GPU giả lập.

## Complexity Tracking
Không có vi phạm.
