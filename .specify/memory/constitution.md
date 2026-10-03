# StudioFlow Agent — Constitution

**Phiên bản:** 1.0 · **Ngày:** 03/10/2026
**Vị trí khi triển khai:** chép nguyên văn vào `.specify/memory/constitution.md` của repo.

Các nguyên tắc bất biến cho mọi tính năng. `plan.md` của mỗi tính năng PHẢI qua các gate ở cuối file; vi phạm chỉ được chấp nhận khi ghi lý do trong mục *Complexity Tracking* của `plan.md`.

---

## Điều I — Spec là nguồn sự thật
Code phục vụ spec, không ngược lại. Code lệch spec là lỗi. Muốn đổi hành vi: sửa tài liệu trong `docs/` trước, rồi cập nhật spec tính năng, rồi mới sửa code. Chỗ chưa rõ PHẢI ghi `[NEEDS CLARIFICATION: câu hỏi]`; tính năng còn dấu này không được chuyển sang implement.

## Điều II — Thư viện trước
Mọi logic lõi (mô hình miền, Gateway, Workflow Engine, build graph, job/cache, chính sách) nằm trong `packages/core` dưới dạng module có API rõ ràng. Electron main/renderer chỉ gọi API này; không viết logic nghiệp vụ trong UI.

## Điều III — Giao diện CLI
Mỗi module lõi có lệnh CLI `sf <module> <lệnh>` nhận tham số/JSON từ stdin, trả JSON ra stdout, lỗi ra stderr với mã lỗi. CLI dùng cho test, debug và cho `script.run`.

## Điều IV — Test trước (bất khả thương lượng)
Viết test từ tiêu chí nghiệm thu (`AC-…`) và hợp đồng trước; chạy để thấy test fail; sau đó mới viết code cho đến khi pass. Thứ tự file test: contract → integration → end-to-end → unit.

## Điều V — Hợp đồng có phiên bản
Schema artifact, tool MCP, capability, manifest được định nghĩa một lần trong `docs/` (JSON Schema/TypeScript type) và sinh/kiểm từ đó. Mọi thay đổi hợp đồng tăng `schema_version`, kèm migration và contract test. Không có hai định nghĩa song song cho cùng một thực thể.

## Điều VI — An toàn file
Mọi lần ghi vào kênh/video/kho dữ liệu app đi qua **module ghi của Gateway** (lối vào: `artifact.write`, `studio.commit`, đầu ra capability, `upload.ingest`, ghi nội bộ kho nhạc app — D3 mục 8); ghi nguyên tử (file tạm → đổi tên); không xóa hay ghi ra ngoài project; sao lưu trước migration và trước ghi đè phần đã duyệt/đã chỉnh tay.

## Điều VII — Quan sát được
Mọi thao tác sinh nội dung ghi provenance (provider, model, tham số, seed, nguồn). Mọi bước workflow, tool call, job, vòng `refine-loop` có span trace. Log có cấu trúc (JSON), có mã yêu cầu/tính năng liên quan khi có thể.

## Điều VIII — Đơn giản
Tối đa 3 project: `apps/desktop` (Electron + React), `packages/core` (TypeScript/Node), `workers/gpu` (Python). Gói trong `extensions/` là dữ liệu + script, không phải project. Không thêm tính năng hay tầng "để sau này dùng" ngoài các điểm mở rộng kiến trúc đã định.

## Điều IX — Chống trừu tượng thừa
Chỉ có lớp adapter ở các ranh giới đã định trong kiến trúc: Agent Runtime Port, provider adapter của capability, HyperFrames adapter, adapter ComfyUI. Bên trong lõi dùng trực tiếp thư viện/framework, không bọc thêm. Mô hình miền có đúng một biểu diễn.

## Điều X — Kiểm thử tích hợp thật
Ưu tiên chạy thật HyperFrames, FFmpeg, ComfyUI, OmniVoice, file system. Chỉ giả lập: LLM (ghi/phát lại phản hồi), và các bước GPU khi chạy trên máy không có GPU. Test cần GPU gắn nhãn `gpu` và chạy trên máy tham chiếu trước khi đóng tính năng.

## Điều XI — Truy vết
Mỗi `spec.md` tính năng liệt kê các mã `FR-…`/`AC-…` nó phủ và mục tài liệu `docs/` nó dựa vào. Mỗi task, test và commit tham chiếu số tính năng (`NNN`) và mã yêu cầu.

---

## Gate trước khi implement (dùng trong `plan.md`)

- [ ] **Spec (I):** không còn `[NEEDS CLARIFICATION]`; mọi yêu cầu kiểm được.
- [ ] **Thư viện + CLI (II, III):** logic nằm trong `packages/core` hoặc `workers/gpu`, có lệnh CLI.
- [ ] **Test trước (IV):** có danh sách test fail-trước cho từng AC.
- [ ] **Hợp đồng (V):** dùng schema/type từ `docs/`, không định nghĩa lại; thay đổi hợp đồng có migration.
- [ ] **An toàn file (VI):** không có đường ghi nào ngoài Gateway.
- [ ] **Quan sát (VII):** có provenance và span cho thao tác mới.
- [ ] **Đơn giản (VIII):** không thêm project; không có phần "để sau này".
- [ ] **Trừu tượng (IX):** không thêm lớp bọc ngoài các ranh giới đã định.
- [ ] **Tích hợp (X):** test chạy với thành phần thật, chỉ giả lập LLM/GPU theo quy định.

## Sửa constitution
Chỉ sửa khi có lý do ghi rõ, tăng phiên bản, cập nhật ngày; thay đổi áp dụng cho tính năng lập kế hoạch sau đó.
