# Feature Specification: Repo Scaffold (khung monorepo)

**Feature Branch**: `001-repo-scaffold`

**Created**: 2026-10-03

**Status**: Draft

**Input**: User description: "001-repo-scaffold: monorepo 3 project (apps/desktop, packages/core, workers/gpu), CLI `sf`, lint/test, đóng gói Windows. Phủ NFR-09. Dựa trên constitution, D12. Không phụ thuộc tính năng nào."

**Phủ yêu cầu**: NFR-09 (một phần — dựng *hạ tầng* để mỗi workflow sau này có dự án mẫu chạy trong hồi quy; bản thân dự án mẫu thuộc các tính năng workflow) · D12 mục 1, 2, 7 (loại test, nền CI) · constitution Điều II, III, IV, VIII, X, XI.

**Dựa trên `docs/`**: `constitution.md` · `docs/README.md` mục 3.2 (cấu trúc repo) · `docs/04-spec-capability-gateway.md` mục 12 (quy ước CLI `sf`) · `docs/12-spec-testing.md` · `docs/tech-defaults.md` mục 6 (gợi ý, không ràng buộc).

## Bối cảnh & mục tiêu

Mọi tính năng sau (002–032) cần một chỗ đứng chung: cùng cấu trúc thư mục, cùng cách chạy test/lint, cùng cách gọi lệnh `sf`, và một đường ra bản cài đặt Windows. Tính năng này **chỉ dựng khung** — không chứa logic nghiệp vụ (mô hình miền, Gateway, workflow, TTS… thuộc các tính năng 002+). Mục tiêu: một lập trình viên (hoặc Claude Code) clone repo, chạy vài lệnh là build/test/lint được trên Windows 11 x64, và các tính năng sau chỉ việc thêm module vào đúng chỗ.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Thiết lập và chạy kiểm tra từ repo sạch (Priority: P1)

Lập trình viên clone repo trên máy Windows 11 x64 mới (đã có công cụ nền tảng đã liệt kê), làm theo `quickstart.md`, cài phụ thuộc, rồi chạy một lệnh duy nhất để build + lint + test toàn bộ ba project. Kết quả xanh, có báo cáo rõ project nào pass/fail.

**Why this priority**: Không có vòng lặp build/lint/test tin cậy thì không thể thực hiện Điều IV (test trước) cho bất kỳ tính năng nào. Đây là giá trị nền tảng tối thiểu.

**Independent Test**: Trên repo sạch, chạy quy trình thiết lập trong `quickstart.md` rồi lệnh kiểm tra tổng; đạt khi mã thoát = 0 và báo cáo liệt kê đủ ba project với số test ≥ 1 mỗi project.

**Acceptance Scenarios**:

1. **Given** repo vừa clone trên máy sạch, **When** làm theo `quickstart.md` và chạy lệnh kiểm tra tổng, **Then** build, lint và test của cả ba project hoàn tất với mã thoát 0.
2. **Given** một test cố ý bị làm hỏng ở một project, **When** chạy lệnh kiểm tra tổng, **Then** lệnh thất bại (mã thoát ≠ 0) và báo cáo chỉ rõ project và test hỏng.
3. **Given** một file vi phạm quy tắc lint ở một project, **When** chạy lint, **Then** lint thất bại và chỉ ra file/dòng vi phạm.
4. **Given** lệnh kiểm tra tổng chạy lần thứ hai không đổi gì, **When** chạy lại, **Then** kết quả như lần đầu (xác định, không phụ thuộc trạng thái còn sót).

---

### User Story 2 - Gọi CLI `sf` theo đúng quy ước (Priority: P1)

Lập trình viên (và sau này agent qua `script.run`) chạy `sf` từ dòng lệnh. Khung CLI hiển thị phiên bản, trợ giúp, và một lệnh chẩn đoán/mẫu để chứng minh quy ước: nhận tham số hoặc JSON từ stdin, in JSON ra stdout, lỗi ra stderr dạng `{code, message}`, mã thoát 0/1/2. Các tính năng sau đăng ký thêm lệnh `sf <module> <lệnh>` mà không phải sửa khung.

**Why this priority**: Constitution Điều III bắt mọi module lõi có CLI; quy ước đầu vào/đầu ra/mã thoát phải cố định ngay từ đầu vì D4 mục 12 và `script.run` dựa vào nó.

**Independent Test**: Chạy `sf --version`, `sf --help`, lệnh mẫu với tham số hợp lệ, tham số sai, và đầu vào JSON qua stdin; so stdout/stderr/mã thoát với bảng quy ước.

**Acceptance Scenarios**:

1. **Given** CLI đã cài trong repo, **When** chạy `sf --version`, **Then** in phiên bản hiện tại dưới dạng JSON ra stdout, mã thoát 0.
2. **Given** lệnh mẫu của khung, **When** gọi với tham số hợp lệ (qua dòng lệnh, và tương đương qua JSON stdin), **Then** stdout là JSON hợp lệ, stderr rỗng, mã thoát 0.
3. **Given** lệnh mẫu, **When** gọi với tham số thiếu/sai kiểu, **Then** stderr là `{code, message}`, stdout rỗng, mã thoát 2.
4. **Given** lệnh mẫu được lập trình để thất bại nghiệp vụ, **When** chạy, **Then** stderr là `{code, message}` với mã lỗi, mã thoát 1.
5. **Given** một module giả thêm lệnh `sf <module> <lệnh>` mới, **When** chạy `sf --help`, **Then** lệnh mới xuất hiện mà không phải sửa mã của khung CLI.

---

### User Story 3 - Ba project có biên giới rõ và giao tiếp được (Priority: P2)

Cấu trúc repo đúng 3 project theo constitution Điều VIII: `apps/desktop`, `packages/core`, `workers/gpu`, cộng thư mục dữ liệu `extensions/` (không phải project). Mỗi project có "xin chào" tối thiểu chứng minh nó chạy được độc lập, và app desktop gọi được API của `core` (không chứa logic nghiệp vụ — Điều II).

**Why this priority**: Giữ ranh giới đúng từ đầu rẻ hơn tách sau; nhưng khung vẫn dùng được (Story 1, 2) kể cả khi phần giao tiếp chưa hoàn chỉnh, nên P2.

**Independent Test**: Khởi chạy từng project độc lập (core qua CLI, worker qua lệnh tự kiểm, desktop mở cửa sổ rỗng) và kiểm tra cửa sổ desktop hiển thị được thông tin phiên bản lấy từ `core`.

**Acceptance Scenarios**:

1. **Given** repo đã thiết lập, **When** liệt kê project của repo, **Then** có đúng ba project (`apps/desktop`, `packages/core`, `workers/gpu`) và không có project thứ tư; `extensions/` chỉ chứa dữ liệu/script.
2. **Given** app desktop khởi chạy từ mã nguồn, **When** cửa sổ chính mở, **Then** hiển thị phiên bản `core` lấy qua API của `core` (không tính ở lớp giao diện).
3. **Given** worker `workers/gpu`, **When** chạy lệnh tự kiểm, **Then** worker báo trạng thái sẵn sàng bằng JSON và thoát mã 0, kể cả trên máy không có GPU.
4. **Given** quy tắc phụ thuộc giữa các project, **When** một file trong `apps/desktop` import trực tiếp nội bộ (không qua API công khai) của `core`, **Then** kiểm tra tĩnh của repo báo vi phạm.

---

### User Story 4 - Đóng gói thành bản cài đặt Windows (Priority: P2)

Lập trình viên chạy một lệnh đóng gói và nhận ra một bản cài đặt Windows x64. Cài trên máy Windows 11 sạch rồi mở app thì thấy cửa sổ khung với phiên bản; gỡ cài đặt thì sạch.

**Why this priority**: Phát hiện sớm lỗi đóng gói (đường dẫn, phụ thuộc native) rẻ hơn nhiều so với phát hiện ở M1; nhưng không chặn các story còn lại.

**Independent Test**: Chạy lệnh đóng gói; cài bản tạo ra trên máy sạch (hoặc môi trường cô lập), mở app, kiểm tra cửa sổ + phiên bản, gỡ cài đặt và kiểm tra không còn file chương trình.

**Acceptance Scenarios**:

1. **Given** repo đã build xanh, **When** chạy lệnh đóng gói, **Then** sinh ra một bản cài đặt Windows x64 kèm số phiên bản khớp với phiên bản của repo.
2. **Given** bản cài đặt đã sinh, **When** cài trên máy Windows 11 x64 sạch và mở app, **Then** cửa sổ chính mở và hiển thị phiên bản.
3. **Given** app đã cài, **When** gỡ cài đặt, **Then** thư mục chương trình bị xóa và dữ liệu người dùng (nếu có) không bị xóa ngầm.
4. **Given** gói cài đặt, **When** kiểm tra nội dung, **Then** CLI `sf` có trong gói và gọi được từ bản đã cài *hoặc* quyết định không đưa vào gói được ghi rõ [NEEDS CLARIFICATION: bản cài đặt có kèm CLI `sf` và runtime (Node/Python/FFmpeg) không, hay chỉ vỏ app? Mặc định đề xuất: chỉ vỏ app + `core`; Python worker và FFmpeg do tính năng 014 (model-manager-install) lo.]

---

### User Story 5 - Hạ tầng kiểm thử và CI theo D12 (Priority: P2)

Khung test có sẵn chỗ cho các loại test của D12 (contract, integration, e2e, gpu, ui, unit) cho ba project, gắn nhãn `gpu` để tách khỏi CI, chế độ giả lập LLM/GPU điều khiển bằng biến môi trường (`SF_GPU`, `SF_LLM`) theo D12 mục 2. CI chạy trên Windows không GPU và chặn merge khi đỏ.

**Why this priority**: Constitution Điều IV/X bắt buộc; nhưng nội dung test cụ thể thuộc từng tính năng, khung chỉ cần *chạy được* với test mẫu.

**Independent Test**: Chạy từng loại test mẫu riêng lẻ qua lệnh `sf test` hoặc lệnh của project; kiểm tra test gắn nhãn `gpu` bị bỏ qua khi `SF_GPU=0`; mở một PR thử có test đỏ và kiểm tra CI chặn.

**Acceptance Scenarios**:

1. **Given** có test mẫu cho mỗi loại (contract, integration, e2e, unit), **When** chạy riêng từng loại, **Then** mỗi loại chạy độc lập và báo kết quả riêng.
2. **Given** `SF_GPU=0`, **When** chạy toàn bộ test, **Then** test gắn nhãn `gpu` được bỏ qua (báo rõ là skipped, không phải pass).
3. **Given** `SF_LLM=replay` và một test cần phản hồi LLM chưa có bản ghi, **When** chạy test, **Then** test fail (không gọi mạng ngầm).
4. **Given** một PR có test đỏ hoặc lint đỏ, **When** CI chạy trên Windows không GPU, **Then** CI báo đỏ và PR không đủ điều kiện merge.
5. **Given** quy ước Điều IV, **When** tính năng mới thêm test, **Then** có chỗ/mẫu rõ ràng cho thứ tự contract → integration → e2e → unit.

---

### User Story 6 - Quy ước truy vết và commit được kiểm (Priority: P3)

Mỗi commit và test tham chiếu số tính năng (`NNN`) và mã FR/AC theo Điều XI. Khung cung cấp kiểm tra nhẹ (cục bộ và CI) báo commit/PR thiếu `NNN`.

**Why this priority**: Giá trị thật nhưng không chặn việc phát triển; có thể bổ sung sau cùng.

**Independent Test**: Tạo commit thử không có `NNN` → kiểm tra báo lỗi; có `NNN` → qua.

**Acceptance Scenarios**:

1. **Given** commit message thiếu số tính năng, **When** chạy kiểm tra, **Then** báo lỗi nêu quy ước cần theo.
2. **Given** commit message có `001` và mã FR/AC hợp lệ, **When** chạy kiểm tra, **Then** qua.

---

### Edge Cases

- Máy thiếu công cụ nền tảng (Node, Python, trình quản lý gói…): lệnh thiết lập/kiểm tra phải báo rõ công cụ nào thiếu và phiên bản tối thiểu, không thất bại mơ hồ.
- Đường dẫn repo có khoảng trắng hoặc ký tự Unicode (ví dụ thư mục người dùng Windows có dấu cách): build, test, CLI và đóng gói vẫn chạy.
- Máy không có GPU / không có NVIDIA driver: mọi thứ trong khung (kể cả worker tự kiểm) chạy được.
- Cuối dòng (LF/CRLF) khác nhau giữa máy: lint/test không đỏ chỉ vì cuối dòng.
- Chạy `sf` từ thư mục bất kỳ (không phải gốc repo): vẫn tìm được cấu hình của mình hoặc báo lỗi rõ.
- Lệnh `sf` nhận JSON stdin không hợp lệ hoặc quá lớn: mã thoát 2 và `{code, message}`, không treo.
- Đóng gói khi build chưa xanh: lệnh đóng gói từ chối chạy và nói rõ lý do.
- Hai lệnh `sf` trùng tên do hai module đăng ký: phát hiện lúc khởi động/test, không chọn ngầm một bên.

## Requirements *(mandatory)*

### Functional Requirements

**Cấu trúc & ranh giới**

- **FR-SC-001**: Repo PHẢI có đúng ba project: `apps/desktop`, `packages/core`, `workers/gpu`; thư mục `extensions/` PHẢI chỉ chứa dữ liệu/script, không là project (constitution Điều VIII).
- **FR-SC-002**: Repo PHẢI có kiểm tra tự động phát hiện (a) project thứ tư, (b) `apps/desktop` truy cập nội bộ không công khai của `core` (Điều II), và báo lỗi khi vi phạm.
- **FR-SC-003**: Mỗi project PHẢI có ít nhất một test mẫu pass và một "điểm vào" tối thiểu chạy được độc lập.

**Lệnh chuẩn & chất lượng**

- **FR-SC-004**: PHẢI có một lệnh duy nhất chạy build + lint + test cho cả ba project, mã thoát ≠ 0 khi bất kỳ bước nào lỗi, và một báo cáo tóm tắt theo project.
- **FR-SC-005**: PHẢI có lint/format cho từng ngôn ngữ trong repo (TypeScript và Python) với cấu hình chung ở gốc repo; vi phạm làm lint thất bại.
- **FR-SC-006**: Lệnh thiết lập/kiểm tra PHẢI phát hiện công cụ nền tảng thiếu hoặc sai phiên bản và báo rõ tên + phiên bản tối thiểu.
- **FR-SC-007**: Build/test/lint PHẢI chạy đúng trên Windows 11 x64 với đường dẫn chứa khoảng trắng hoặc Unicode.

**CLI `sf`**

- **FR-SC-008**: CLI `sf` PHẢI tuân quy ước của D4 mục 12: nhận tham số dòng lệnh hoặc JSON từ stdin; JSON ra stdout; lỗi ra stderr dạng `{code, message}`; mã thoát 0 (thành công) / 1 (lỗi nghiệp vụ) / 2 (lỗi tham số).
- **FR-SC-009**: Khung CLI PHẢI cung cấp `sf --version` và `sf --help`, cùng ít nhất một lệnh mẫu/chẩn đoán phủ đủ ba mã thoát để test quy ước.
- **FR-SC-010**: Khung CLI PHẢI cho phép module khác đăng ký lệnh `sf <module> <lệnh>` mà không sửa mã khung; phát hiện trùng tên lệnh.
- **FR-SC-011**: Logic của CLI PHẢI nằm trong `packages/core` (Điều II); CLI chỉ là lớp vỏ gọi API.

**Kiểm thử & CI**

- **FR-SC-012**: Khung test PHẢI hỗ trợ các loại test của D12 mục 1 (contract, integration, e2e, gpu, ui, unit), cho phép chạy riêng từng loại, và mỗi loại có ít nhất một test mẫu (trừ `gpu` và `ui` chỉ cần có chỗ + nhãn nếu chưa có nội dung).
- **FR-SC-013**: Test gắn nhãn `gpu` PHẢI bị bỏ qua và báo "skipped" khi `SF_GPU=0`; `SF_LLM=replay` PHẢI là mặc định ở CI và test thiếu bản ghi PHẢI fail, không gọi mạng (D12 mục 2).
- **FR-SC-014**: PHẢI có CI chạy trên Windows không GPU (`SF_GPU=0`, `SF_LLM=replay`) thực hiện build + lint + test; CI đỏ PHẢI chặn merge (D12 mục 7).
- **FR-SC-015**: Báo cáo test PHẢI cho thấy được độ phủ dòng của `packages/core`; ngưỡng cụ thể do plan/tech-defaults quyết định và CI PHẢI áp ngưỡng đó.

**Đóng gói**

- **FR-SC-016**: PHẢI có một lệnh đóng gói sinh bản cài đặt Windows x64 mang số phiên bản của repo; từ chối chạy nếu build/test chưa xanh.
- **FR-SC-017**: Bản cài đặt PHẢI cài, mở được cửa sổ chính hiển thị phiên bản `core`, và gỡ cài đặt sạch phần chương trình mà không xóa ngầm dữ liệu người dùng.
- **FR-SC-018**: Việc bản cài đặt có ký số mã hay không PHẢI được quyết định trước khi phát hành [NEEDS CLARIFICATION: ký số mã ở 001 hay để sau? Mặc định đề xuất: không ký ở 001 (chỉ phục vụ nội bộ M0/M1), ghi chú rủi ro SmartScreen trong quickstart.]

**Truy vết**

- **FR-SC-019**: Repo PHẢI có kiểm tra (cục bộ và CI) báo lỗi khi commit/PR không chứa số tính năng `NNN` (Điều XI).
- **FR-SC-020**: `quickstart.md` của tính năng PHẢI mô tả thiết lập từ repo sạch đến build/test/đóng gói xanh, đủ để người mới làm theo không cần hỏi thêm.

### Key Entities *(include if feature involves data)*

- **Project**: một trong ba đơn vị build/test (`apps/desktop`, `packages/core`, `workers/gpu`); có điểm vào tối thiểu, test mẫu, cấu hình lint riêng.
- **Lệnh `sf`**: cặp (module, lệnh) đăng ký với khung CLI; có tham số, hình dạng JSON đầu ra, bảng mã lỗi.
- **Loại test**: nhãn phân loại (contract, integration, e2e, gpu, ui, unit) quyết định test nào chạy ở đâu.
- **Bản cài đặt**: sản phẩm của lệnh đóng gói; gắn số phiên bản, nền tảng Windows x64.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Một lập trình viên mới đi từ repo vừa clone đến lúc build + lint + test xanh trong ≤ 15 phút (không tính thời gian tải phụ thuộc) chỉ bằng `quickstart.md`.
- **SC-002**: Lệnh kiểm tra tổng trên repo không đổi cho kết quả giống nhau qua 3 lần chạy liên tiếp (0 test chập chờn).
- **SC-003**: 100% quy ước CLI (stdout JSON, stderr `{code, message}`, mã thoát 0/1/2) được test tự động bao phủ cho lệnh mẫu.
- **SC-004**: Bản cài đặt sinh ra cài và mở được trên một máy Windows 11 x64 sạch ở lần thử đầu, và gỡ cài đặt không để lại file chương trình.
- **SC-005**: CI báo kết quả cho một thay đổi trong ≤ 10 phút trên repo ở trạng thái khung, và một PR có test đỏ không thể merge.
- **SC-006**: Thêm một lệnh `sf` mới và một test mẫu cho nó chỉ cần chạm các file thuộc module mới (0 file của khung CLI bị sửa).

## Phạm vi

**Trong phạm vi**: cấu trúc repo; ba project với điểm vào tối thiểu; lệnh kiểm tra tổng; lint/format; khung CLI `sf` và quy ước; khung test theo D12; CI Windows; đóng gói bản cài đặt; kiểm tra truy vết commit; `quickstart.md`.

**Ngoài phạm vi** (thuộc tính năng khác): mô hình miền/schema (002), Gateway MCP và chính sách ghi (003), job/cache/build graph (004), Agent Runtime (005), TTS và worker GPU thật (006), giao diện chat/explorer (008), cài/tải model (014), `docs/contracts/` (002), dự án mẫu hồi quy từng workflow (các tính năng workflow), Studio/HyperFrames/FFmpeg/ComfyUI.

## Assumptions

- Nền tảng mục tiêu duy nhất: Windows 11 x64 (đã chốt ở `docs/README.md` mục 2); không hỗ trợ macOS/Linux ở 001.
- Lựa chọn công nghệ cụ thể (trình quản lý gói, công cụ test/lint, công cụ đóng gói, nền CI) thuộc `plan.md`; `tech-defaults.md` mục 6 là gợi ý không ràng buộc.
- Nội dung bản cài đặt ở 001 là "vỏ app + `core`" (xem câu hỏi ở Story 4); runtime Python/FFmpeg/model tải sau bởi tính năng 014.
- Worker `workers/gpu` ở 001 chỉ có lệnh tự kiểm chạy được trên CPU; không có model, không cần GPU.
- Hệ thống quản lý mã nguồn là Git với CI do nền tảng lưu trữ mã nguồn cung cấp; quy tắc "một tính năng = một nhánh `NNN-<tên>`" theo `docs/README.md` mục 3.3.
- Dự án chưa có người dùng cuối; "người dùng" của tính năng này là lập trình viên và Claude Code.
- Ngưỡng độ phủ, dung sai và các giá trị số cụ thể lấy từ `tech-defaults.md` khi `plan` (lệch thì ghi lý do trong `research.md`).
