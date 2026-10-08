# 080 — Kịch bản: ID dòng do model tự đặt sai mẫu; model chép lại khung prompt sửa

## Vấn đề
vd_rbxtpyp5 (Shorts, Nuvora, 2026-10-08) lỗi bước Kịch bản: `artifact_valid(SCRIPT.md): /beats/1/line_ids/3 must match pattern "^ln_[0-9a-z]{8}$"`. Ở vòng sửa (refine), model tách một dòng và tự đặt `id=ln_j5u9imcg_b`; `assignScriptIds` giữ mọi ID có sẵn nên ID sai lọt qua. Cùng file, model chép lại khung prompt sửa (`# Brief` … `# Bản nháp`) vào đầu kịch bản.

## Yêu cầu
- FR-TX-80-01 `assignScriptIds`: ID beat/line không đúng mẫu (`bt_`/`ln_` + 8 ký tự `[0-9a-z]`) → bỏ, gán ID mới (theo seed); ID đúng giữ nguyên.
- FR-TX-80-02 `stripWrapping`: có tiêu đề `# Bản nháp` → chỉ giữ phần sau; có `# Vấn đề cần sửa` → bỏ từ đó trở đi.

## AC
- `script-robust.test.ts`: `ln_j5u9imcg_b` → ID mới hợp lệ, schema qua; khung prompt bị chép → chỉ còn bản nháp.
- Chạy thử trên SCRIPT.md thật của vd_rbxtpyp5: 1 ID được gán lại, không còn Brief, `checkScript` không lỗi.
