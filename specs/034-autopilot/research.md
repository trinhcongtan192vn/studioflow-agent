# Research — 034

## R1. Cấu hình hay đổi manifest
Có thể thêm cờ `approval.key` vào manifest, nhưng sẽ đổi hợp đồng `WorkflowManifest` và cả năm gói workflow, trong khi danh sách điểm chốt lại là lựa chọn của người dùng, không phải của workflow. Chọn khóa cấu hình theo tầng: người dùng/kênh/video tự đặt; manifest giữ nguyên.

## R2. Ghi nhận tự duyệt
Schema `Approval` (D3) không có trường "ai duyệt". Dùng `note` ("Tự duyệt (chế độ tự động)" + tóm tắt bước) để không đổi schema; trace span `sf.workflow.step` vẫn ghi lại bước.

## R3. Chỉ dẫn cho agent
Chỉ dẫn bước (`instructionFor`) nằm trong khóa bản ghi replay LLM; đổi nó sẽ mất toàn bộ bản ghi E2E. Vì vậy hành vi tự quyết được ghi vào skill `studioflow` (agent đọc `workflow.autopilot` qua `config.resolve`). Chỉ dẫn bổ sung chỉ thêm ở nhánh mới (thiếu giọng), là nhánh chưa có bản ghi.

## R4. Test cũ
E2E hiện có duyệt tay từng điểm. Fixture `settings.json` của app đặt `workflow.autopilot: false` để giữ nguyên các luồng đó; test mới bật autopilot ở tầng video.
