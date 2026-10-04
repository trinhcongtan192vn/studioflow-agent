# Research — 020

## R1. `frame_html` không có builder thuần
- Frame do phiên agent `frame` viết (011). Builder `frame_html` gọi `FrameRebuilder` (WorkflowService) → executor frame-build cho đúng frame (`only`), `waitFrame` của engine video, **không** gọi `graph.build` trước/sau (đang ở trong `graph.build` → khóa theo video sẽ tự khóa). Thời gian/captions đã có trong bản ghi graph.
- File frame hợp lệ (qua `checkFrameFile`) mà graph chưa có bản ghi → nhận luôn (dự án cũ, frame viết tay, test) thay vì gọi agent. Bước frame-build ghi nhận frame vào graph (`markBuilt`) để `graph.build` sau đó không sinh lại.
- Đầu vào làm tròn theo video frame (D4 8.3 "thời lượng đổi vượt 1 video frame"): mốc/thời lượng trong đầu vào nút làm tròn về số video frame theo fps của output profile.

## R2. Ghim
- Nguồn sự thật: `state.json.pinned_frames` (D3 5.5, do Studio commit ghi — 025). Bản ghi graph của frame giữ `input_hash` lúc dựng/ghim → so với đầu vào hiện tại: bằng → `pinned`, khác → `pinned_stale` (`decision_required`). Không lập job cho cả hai.

## R3. Seed theo scene
- FN-023: seed cố định theo scene → `seed = parseInt(sha256(scene_id).slice(0, 8), 16) % 2^31`; cùng prompt + scene → cùng ảnh (cache trúng).

## R4. `render` chỉ khi chọn
- Build mặc định (không mục tiêu) không render (render nháp tốn phút; bước finalize/`render.video` đã quản lý render). `graph.build {targets: ['render']}` → render nháp; trạng thái từ `renders/*/render.json` (`mode: draft`, `status: done`, `index_hash`).

## R5. Ước tính
- Planner đồng bộ (không gọi `health`): provider = `provider.<capability>` đã đăng ký (SF_GPU=0 → provider giả), khóa cache tính như `runCapability` → `cache/objects/<k>/meta.json` có → `from_cache`. Chi phí: `settings.pricing` (`unit: image`) theo provider, thiếu → `policy.paid_api.per_call_usd`.
