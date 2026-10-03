# Implementation Plan: Workflow Engine

**Branch**: `007-workflow-engine` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

## Summary
`packages/core/src/workflow/`: `semver.ts` (range tối giản), `library.ts` (bảng D6 mục 2), `packs.ts` (nạp + kiểm gói, `validateManifest`), `gates.ts`, `engine.ts` (`WorkflowEngine` theo video: briefing, vòng đời, approval, rewind, auto-run, khôi phục, sự kiện), `service.ts` (cache engine theo video, registry executor, `AgentStepRunner`), `tools.ts` (tool `workflow.*`, `approval.annotate`); CLI `ext validate`, `workflow list|state`. Gói fixture `tests/fixtures/workflows/demo-explainer/`.

## Technical Context
TypeScript/Node 22 · không thêm phụ thuộc (semver range tự viết, đủ cho `>=a <b`, `^`, `~`, `=`) · Storage: `state.json`, `BRIEF.md` qua `WriteStore` · Testing: Vitest — contract (schema manifest, `VideoStateSummary`, tool policy), integration (engine với executor/agent giả, FS thật, kill test tiến trình thật), unit (semver, library order check, gates).

## Constitution Check
- [x] I · [x] II/III (`core/src/workflow`, CLI) · [x] IV · [x] V (`WorkflowManifest`, `StepDecl`, `GateDecl`, `VideoState`, `Approval`, `VideoStateSummary` từ `docs/contracts`) · [x] VI (`state.json`/`BRIEF.md` qua module ghi) · [x] VII (log mỗi chuyển trạng thái bước; span ở 015) · [x] VIII · [x] IX · [x] X.

## Project Structure
```text
packages/core/src/workflow/{semver,library,packs,gates,engine,service,tools}.ts
packages/core/src/modules/{ext,workflow}/cli.ts
packages/core/tests/fixtures/workflows/demo-explainer/{workflow.yaml,.claude-plugin/plugin.json,skills/demo-explainer/SKILL.md}
```

## Complexity Tracking
Không có vi phạm.
