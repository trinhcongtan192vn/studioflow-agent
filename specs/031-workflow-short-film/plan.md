# Implementation Plan: Workflow `short-film`

**Branch**: `031-workflow-short-film` | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

## Summary
`domain/markdown/cast.ts` (`assignCastIds`) + `artifact.write`; `workflow/cast.ts` (`speakerVoiceProblems`, objective `speakers_voiced`, `castExecutor`); `tts/builder.ts` (giọng cảm xúc); graph `emotion_ref`; `render/animatic.ts`; `captions-html` màu theo người nói; gói `short-film`. Test: `short-film.test.ts` (E2E); helper E2E thêm phiên producer.

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V · [x] VI · [x] VII · [x] VIII · [x] IX · [x] X.
