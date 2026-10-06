# 042 — Marker `sf:` lạ trong SCRIPT.md

## Vấn đề
Producer đôi khi tự thêm chú thích dạng `<!-- sf:visual text="…" -->` (gợi ý hình). Parser kịch bản (D3) chỉ chấp nhận `sf:beat`, `sf:line`, `sf:tts` nên bước Kịch bản thất bại: `artifact_valid(SCRIPT.md): line N: unexpected marker`.

## Yêu cầu
- FR-SC-42-01: `stripWrapping` (chuẩn hoá đầu ra producer) đổi mọi marker `sf:<tên>` khác `beat|line|tts` thành chú thích thường `<!-- <tên>: <nội dung> -->` — giữ gợi ý cho bước sau, không đổi schema.
- AC: kịch bản có `sf:visual` sau chuẩn hoá qua `checkScript` schema = pass; marker beat/line giữ nguyên.

Test: `packages/core/tests/unit/script-robust.test.ts` ("unknown sf markers from the producer (042)").
