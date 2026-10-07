# 052 — Quyết định kỹ thuật

## R1. Cổng chất lượng là hook của engine, không phải vòng lặp ngoài
Yêu cầu: engine duyệt với note `Autopilot: <lý do>`. `WorkflowEngine` nhận `autoDecide` (EngineDeps, lấy lười từ `WorkflowService.setAutoDecide` để engine đã mở cũng nhận). Hook chạy **đồng bộ trong `finishStep`** ngay khi điểm chốt được tạo, nên video không từng "chờ duyệt" rồi mới duyệt — và `advance()` chạy tiếp liền. Điều kiện kép trong engine: `state.autopilot` **và** `autopilot.enabled` của kênh **và** điểm chốt (`workflow.key_approvals`); điểm không chốt vẫn do "Tự duyệt bước" (034). Video làm tay trong kênh Autopilot không có `state.autopilot` nên hành vi y nguyên (test). Note `Autopilot: …` được nhận là approval "tự duyệt" (`isAutoApproval`) → file đổi sau đó chỉ cập nhật hash như 034. Không đạt: note `Cần người duyệt (Autopilot): …` (không bắt đầu bằng tiền tố tự duyệt) để người dùng thấy vì sao.
Brief không đi qua `finishStep` (tạo ở `select`) nên vòng điều khiển của bộ chạy quyết brief rồi gọi `approve(id, note)` (thêm tham số `note`).
Bộ chạy vẫn quyết lại điểm chốt đang chờ mà chưa có quyết định (app tắt giữa lúc engine tạo approval và lúc hook chạy): cùng hàm `autoDecide`.

## R2. Một vòng điều khiển từng bước, không `runTo(cuối)`
`drive` đọc trạng thái, xử lý bước `failed` → điểm `waiting_approval` → chạy bước kế (`runTo(bước đó)`) rồi lặp. Lý do: cần chặn ở từng ranh giới để xử lý lỗi/giờ nghỉ/dừng. Lưu ý: `approve()` của engine tự `advance()` tới điểm chốt tiếp theo, nên một lần duyệt brief có thể chạy gần hết video trong một lời gọi — vòng điều khiển kiểm `stop`/trạng thái sau mỗi lời gọi chứ không giữa các bước đó. Có bộ đếm "không tiến triển" (3 vòng trạng thái không đổi → `failed`) và trần 500 vòng chống chạy mãi.

## R3. Thứ tự ghi khi bắt đầu một mục
(1) chọn ID video, (2) `markPlanItem(in_production, video_id)`, (3) `createVideo({id})`, (4) ghi `state.autopilot`. Sập giữa các bước: mục `in_production` + `video_id` được làm tiếp, bước (3)/(4) chạy lại an toàn (`ensureVideo`). Ngược thứ tự có thể sinh video mồ côi và tạo lần hai. `markPlanItem` là đường ghi duy nhất của bộ chạy vào file kế hoạch (cùng `writePlan` của 051; không ghi nếu không đổi).

## R4. Chờ hạn mức Claude: giờ trong nhật ký, không trong bộ nhớ
Thông báo hạn mức có giờ địa phương ("resets 3am (Asia/Bangkok)") nhưng không có ngày; lấy lần xuất hiện kế tiếp **sau lúc bắt gặp** (đồng hồ bơm vào, không phải giờ file). Bộ chạy ghi `limit.hit` với `data.resume_at`; sau khi khởi động lại, lượt đầu đọc nhật ký hôm nay và hôm qua của các kênh: có `limit.hit` mới nhất chưa có `limit.resume` sau đó và `resume_at` còn ở tương lai → tiếp tục chờ. Không đọc được thì chờ 1 giờ kể từ lúc bắt gặp (đã ghi vào nhật ký nên cũng bền qua khởi động lại). Phân biệt "lỗi hạn mức mới" và "lỗi cũ còn trong `state.json`" bằng `attempt` của bước so với ảnh chụp lúc bắt đầu `drive`: lỗi cũ (đã qua giờ reset hoặc app khởi động lại) → chạy lại bước, không chờ, không tính vào "chạy lại một lần"; tối đa 2 lần liền rồi chờ thêm 1 giờ (chống vòng lặp khi giờ đọc sai). Phát hiện: `isLimitHit` của 050 (cùng mẫu `hit your … limit`); phía host, lượt agent kết thúc bằng sự kiện `error` mang thông báo hạn mức thì ném `E_RUNTIME_RATE_LIMIT` để bước/brief lỗi đúng thông báo (trước đó bước chỉ báo `E_STEP_INCOMPLETE` mơ hồ). Thêm `weekly limit` vào mẫu nhận `E_RUNTIME_RATE_LIMIT` của `agentErrorFrom`.

## R5. Yêu cầu quyền có phí: từ chối ngay, không đổi `PermissionBus.ask` cho video làm tay
`ask` kiểm `state.autopilot` của video trong phiên; chỉ `paid_api` và chỉ video Autopilot đi nhánh mới: phát `permission.requested` (người dùng vẫn thấy yêu cầu), phát `autopilot.blocked`, trả `false`. Bộ chạy nghe `autopilot.blocked` ghi `{tóm tắt, ts}` theo video; khi bước lỗi mà `ts` ≥ `started_at` của bước → đỗ "cần xác nhận chi phí: …" (agent có thể bắt `E_PERMISSION_DECLINED` rồi thất bại bằng mã khác nên không dựa vào mã lỗi). Nếu agent tự xoay xở (chọn provider miễn phí) bước vẫn xong và mục không đỗ. `batch_gen` đã tự đồng ý ở chế độ tự động (034).

## R6. Giọng đọc: dự phòng ở `voiceOf`, không sửa CAST.md
Video Autopilot không có người chọn giọng. `voiceOf` (graph/model) cho nhân vật chưa có `voice_id` dùng `voice.id` của kênh khi `model.autopilot` (đọc `state.autopilot`); người dẫn đã dùng `voice.id`. Executor `voice` bỏ nhánh "giao agent gợi ý giọng rồi chờ người chọn" cho video Autopilot; thiếu `voice.id` → lỗi `no voice for …` như cũ, bộ chạy nhận ra và đỗ "Kênh chưa có giọng đọc". Không ghi `voice_id` vào CAST.md để không đổi nội dung đã duyệt. Ghi nhật ký `voice.default` sau khi bước `voice` xong (không chặn được trước vì `approve()` chạy liền các bước).

## R7. Đọc thời lượng cho quyết định bỏ qua
`audioDurationReading` (workflow/duration.ts) trả `{actual_ms, target_ms}` theo đúng nguồn của gate (audio sau `voice`, timeline ở `finalize`; nguồn lấy từ `params.source` của gate khai báo) và dùng chung `beatDurations`/`timingOf` với kiểm `audio_duration` — không tính lại. So sánh trên phần triệu nguyên để biên 25% chính xác. Không có mục tiêu thời lượng / chưa có audio → đỗ (không đoán).

## R8. Nhật ký vận hành
`autopilot/log/<ngày>.jsonl` theo kênh, ngày = ngày của kế hoạch chứa mục (hoặc ngày hôm nay của kênh cho sự kiện lập kế hoạch), qua `WriteStore.appendLine` (nối thêm, nguyên tử theo dòng); ghi lỗi nuốt (không làm hỏng việc). Logger chung (`sf.autopilot`) nhận cùng dòng (Điều VII). Sự kiện: `plan.built`, `plan.error`, `item.start`, `item.resume`, `brief.done`, `brief.select`, `gate.decision`, `step.waive`, `step.retry`, `voice.default`, `limit.hit`, `limit.resume`, `item.parked`, `item.failed`, `item.produced`. Không ghi dòng cho lượt rỗng (tạm dừng/ngoài khung giờ) để không phình file mỗi 5 phút.

## R9. Hằng số trong code
5 phút/tick, xem lại 2 ngày kế hoạch cho mục dở, 1 lần chạy lại, 2 lần chạy lại sau hạn mức: `RUNNER_CONSTANTS` (tech-defaults), không thêm khóa cấu hình (chưa có số liệu; hiệu chỉnh ở 057). Khóa duy nhất mới là `autopilot.duration_waive_ratio` vì người dùng cần chỉnh theo thể loại video.

## R10. Bộ chạy trong core, brief/kênh do host gắn
`createCore` tạo `core.autopilot` (để tool `autopilot.status` đăng ký cùng Gateway và test lõi dùng không cần host); host gắn `setChannels` (kênh quản lý đang bật) và `setBrief` (phiên `main` của video). Không có brief (CLI) → lỗi `E_STEP_INCOMPLETE` → chạy lại một lần rồi `failed`. Test lõi tạo `AutopilotRunner` riêng với đồng hồ giả và gắn `setAutoDecide` y như core.
