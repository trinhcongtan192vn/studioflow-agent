# Implementation Plan: Bảng caption

**Branch**: `026-caption-panel` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
Core: `hf/captions-html.ts` (`effectiveCaptions` tách/gộp/mốc/chữ + orphan, `captionViolations`), `captions/voice.ts` (giải mã WAV, ghép `voice.wav`, đỉnh 10 ms), `captions/panel.ts` (`CaptionPanel.load/save`, ghi qua Gateway `artifact.write` + `base_hash`), `index-builder` dùng cụm sau override, `graph.status` orphan, IPC `captions.load/save` + sự kiện `artifact.changed`. Desktop: `caption-edit.ts` (thao tác thuần: kéo mép, tách, gộp, sửa chữ, lịch sử), `CaptionPanel.tsx` (audio, canvas dạng sóng, cụm, phím, tự lưu 1 s), giao thức `sf-media:` ở `main`.

## Technical Context
TS/Node 22, React 19, Electron · Testing: unit `caption-overrides.test.ts` (core), `caption-edit.test.ts` (desktop); integration `caption-panel.test.ts` (asr.fake → load/save → build index); UI `workspace.ui.test.ts` (bảng caption, audio qua `sf-media:`, tự lưu).

## Constitution Check
- [x] I · [x] II/III (UI chỉ gọi IPC; ghi qua Gateway) · [x] IV · [x] V (D9 6, D3 5.8) · [x] VI · [x] VII · [x] VIII · [x] IX (`sf-media:` chỉ đọc file dẫn xuất) · [x] X.

## Complexity Tracking
Không thêm phụ thuộc.
