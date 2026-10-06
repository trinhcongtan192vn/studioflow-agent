# StudioFlow Agent — Bộ tài liệu triển khai

Bộ tài liệu này là **nguồn sự thật** để triển khai StudioFlow Agent bằng Claude Code, theo phương pháp **Spec-Driven Development (SDD)** của GitHub Spec Kit: *code phục vụ spec* — code lệch spec là lỗi; muốn đổi hành vi thì sửa spec trước, rồi mới sửa code.

## 1. Danh mục

| File | Mã | Nội dung | Trạng thái |
|---|---|---|---|
| `README.md` | — | Quy ước, quy trình SDD, backlog tính năng | Bản nháp 1.3 |
| `constitution.md` | — | Nguyên tắc bất biến + gate trước implement | Bản nháp |
| `00-architecture.md` | — | Kiến trúc tổng thể v3.0 (lý do, quyết định) | Đã chốt |
| `01-prd.md` | D1 | Yêu cầu sản phẩm, phạm vi theo giai đoạn, tiêu chí nghiệm thu | Bản nháp |
| `02-spike-plan.md` | D2 | Kế hoạch và báo cáo spike S1–S16 | Bản nháp 1.x |
| `03-spec-domain-artifacts.md` | D3 | Mô hình miền, schema artifact, ID, cấu hình theo tầng | Bản nháp 1.x |
| `04-spec-capability-gateway.md` | D4 | Capability, Gateway MCP, provider, job, GPU, cache, build graph, model manager | Bản nháp 1.x |
| `05-spec-agent-runtime-policy.md` | D5 | Agent Runtime Port, tool, chính sách | Bản nháp 1.x |
| `06-spec-workflow-skill.md` | D6 | Workflow manifest, thư viện bước, `refine-loop`, hồ sơ kênh, gói prompt | Bản nháp 1.x |
| ~~D7~~ | — | (Đã chuyển sang `feature-notes/`: ghi chú từng workflow) | — |
| `08-spec-music.md` | D8 | Hợp đồng kho nhạc, tìm nhạc, đặt nhạc vào video | Bản nháp 1.x |
| `09-spec-studio-caption.md` | D9 | Nguồn sự thật, hợp đồng Studio, `studio.commit`, bảng caption | Bản nháp 1.x |
| `10-spec-ui.md` | D10 | Danh mục màn hình, quy tắc UI chung, hợp đồng IPC | Bản nháp 1.x |
| `11-spec-observability.md` | D11 | Trace, eval, chi phí | Bản nháp 1.x |
| `12-spec-testing.md` | D12 | Dự án mẫu, hồi quy, tiêu chí qua | Bản nháp 1.x |
| `13-extension-guide.md` | D13 | Hướng dẫn viết gói mở rộng | Bản nháp 1.x |
| `feature-notes/*.md` | FN-NNN | **Không ràng buộc.** Ghi chú chi tiết theo tính năng (workflow, thuật toán, tương tác UI, tham số) — đầu vào cho `/specify`, `/plan` | Bản nháp |
| `tech-defaults.md` | — | **Không ràng buộc.** Lựa chọn công nghệ, tham số kỹ thuật và **giá trị mặc định của mọi khóa cấu hình** — đầu vào cho `/plan`; đổi mặc định không phải đổi spec hệ thống | Bản nháp |
| `contracts/` | — | JSON Schema / TS type + `errors.json` sinh từ định nghĩa TypeScript và bảng mã lỗi trong D3–D11 (tính năng 002 tạo) | Chưa có |

## 2. Quy ước

- **Ngôn ngữ:** mô tả tiếng Việt; tên file, schema, field, tool, enum, mã lỗi, tên biến bằng tiếng Anh.
- **Thứ tự ưu tiên khi mâu thuẫn:** `constitution.md` > spec hệ thống (D3–D13, `contracts/`) > PRD (D1) > kiến trúc (`00`) > spec tính năng (`specs/NNN-*`) > `feature-notes/`, `tech-defaults.md`. Gặp mâu thuẫn hoặc thiếu thông tin: **dừng và hỏi**, không tự đoán.
- **Ranh giới tầng:** spec hệ thống chỉ chứa *hợp đồng* (schema, tool, manifest, IPC, chính sách, bất biến) và quy tắc dùng chung. Chi tiết chỉ một tính năng dùng (thuật toán, tham số tinh chỉnh, bố cục, phím tắt) thuộc spec tính năng; ngưỡng và giá trị số dùng chung được biểu diễn bằng khóa cấu hình (tên khóa ở D3, giá trị mặc định ở tech-defaults); lựa chọn thư viện/hạ tầng thuộc `plan.md`. Ghi chú sẵn có ở `feature-notes/` và `tech-defaults.md` là gợi ý, được thay khi tính năng đặc tả/lập kế hoạch.
- **Mã ghi chú:** `FN-NNN` = file trong `feature-notes/` có số NNN trong tên (file gộp nhiều tính năng đặt tên `NNN-MMM-…`); `FN-common` = `feature-notes/workflows-common.md`.
- **Mã yêu cầu:** `FR-<nhóm>-<số>` (chức năng), `NFR-<số>` (phi chức năng), `AC-<giai đoạn>-<số>` (nghiệm thu).
- **Từ khóa:** **PHẢI** (bắt buộc), **NÊN** (khuyến nghị, lệch cần lý do), **CÓ THỂ** (tùy chọn).
- **Định nghĩa chuẩn:** khối TypeScript trong D3–D11 là định nghĩa chuẩn của schema/type; bảng mã lỗi trong các spec gộp thành một registry `docs/contracts/errors.json` (mã trùng ở hai tài liệu phải cùng nghĩa). Mã không ghi `retryable` thì mặc định `false`.
- **Tool:** tên logic `nhóm.tên` trong tài liệu; tên MCP thay `.` bằng `_` (D4 mục 2.1).
- **Đánh dấu chưa rõ:**
  - `[chờ Sx]` — giá trị mặc định tạm, thay bằng kết quả spike Sx; **không chặn** implement.
  - `[NEEDS CLARIFICATION: câu hỏi]` — chưa đủ thông tin; **chặn** implement phần liên quan cho đến khi được trả lời.
- **Giai đoạn:** M0 nền móng · M1 bản nội bộ · M2 MVP · M3 chỉnh trực quan · M4 thêm workflow · M5/M5b phim ngắn.
- **Nền tảng đã chốt:** Windows 11 x64; Electron + React (TypeScript); lõi TypeScript/Node; worker GPU Python.

## 3. Spec-Driven Development trong dự án này

### 3.1 Hai tầng spec

| Tầng | Ở đâu | Trả lời | Ai viết | Đổi khi nào |
|---|---|---|---|---|
| **Spec hệ thống** | `docs/` trừ `feature-notes/`, `tech-defaults.md` | Toàn hệ thống cần gì, vì sao; **hợp đồng dùng chung** (schema, tool, manifest, IPC, chính sách, bất biến) | Tan + Claude (chat) | Hiếm; qua quy trình đổi spec (mục 3.5) |
| **Ghi chú đầu vào** | `docs/feature-notes/`, `docs/tech-defaults.md` | Gợi ý chi tiết tính năng và công nghệ đã bàn | Tan + Claude (chat) | Tự do; bị thay bởi spec tính năng/`plan.md` |
| **Spec tính năng** | `specs/NNN-<tên>/` (Spec Kit sinh) | Một lát cắt triển khai: user story, kế hoạch kỹ thuật, task | Claude Code qua lệnh Spec Kit, Tan duyệt | Mỗi tính năng |

Spec tính năng **trích dẫn**, không định nghĩa lại hợp đồng chung: `data-model.md` và `contracts/` của tính năng chỉ chứa phần riêng của tính năng và link tới `docs/contracts/` cho phần dùng chung.

### 3.2 Cấu trúc repo

```
studioflow-agent/                 repo GitHub
  CLAUDE.md                      hướng dẫn cho Claude Code (mục 3.6)
  docs/                          bộ tài liệu này (spec hệ thống)
    contracts/                   JSON Schema / TS type dùng chung
    feature-notes/               ghi chú đầu vào theo tính năng (không ràng buộc)
    tech-defaults.md             công nghệ mặc định (không ràng buộc)
  .specify/
    memory/constitution.md       = docs/constitution.md
    templates/ scripts/          của Spec Kit
  specs/
    001-repo-scaffold/
      spec.md plan.md research.md data-model.md quickstart.md tasks.md
      contracts/
  apps/desktop/                  Electron + React
  packages/core/                 Gateway, Workflow Engine, build graph, domain, CLI `sf`
  workers/gpu/                   Python: OmniVoice, audio-analysis, CLAP (ASR chạy qua HyperFrames `transcribe`)
  extensions/                    gói workflow, provider, blueprint, style, output
```

### 3.3 Quy trình cho mỗi tính năng

Cài Spec Kit (`specify-cli`) và khởi tạo repo với tích hợp Claude Code; tên lệnh chính xác (`/speckit.specify` hoặc `/speckit-specify`) theo phiên bản đã cài.

| Bước | Lệnh Spec Kit | Đầu vào | Đầu ra | Ai duyệt |
|---|---|---|---|---|
| 0 | `constitution` (một lần) | `docs/constitution.md` | `.specify/memory/constitution.md` | Tan |
| 1 | `specify` | Tên tính năng + mã FR/AC + mục `docs/` liên quan + `FN-NNN` nếu có (lấy từ backlog mục 4) | `specs/NNN-*/spec.md`: user story, yêu cầu, AC, phạm vi; chỉ "cái gì/vì sao", không công nghệ | Tan |
| 2 | `clarify` | `spec.md` | Trả lời hết `[NEEDS CLARIFICATION]`; câu trả lời ảnh hưởng hệ thống thì ghi ngược vào `docs/` | Tan |
| 3 | `plan` | `spec.md` + `docs/` + constitution + `tech-defaults.md` (lệch thì ghi lý do trong `research.md`) | `plan.md` (qua gate constitution), `research.md`, `data-model.md`, `contracts/`, `quickstart.md` | Tan |
| 4 | `tasks` | `plan.md` + tài liệu thiết kế | `tasks.md`: task theo thứ tự test → code, task song song đánh `[P]` | — |
| 5 | `analyze` | spec + plan + tasks | Báo cáo mâu thuẫn/thiếu sót giữa các file và với `docs/`; sửa trước khi code | — |
| 6 | `implement` | `tasks.md` | Code + test (test viết và fail trước) | — |
| 7 | Nghiệm thu | `quickstart.md`, mã AC | Chạy kịch bản quickstart và test AC trên máy tham chiếu; cập nhật trạng thái backlog | Tan |

Quy tắc:
- Một tính năng = một nhánh `NNN-<tên>`; commit ghi `NNN` và mã FR/AC.
- Không bắt đầu `implement` khi `analyze` còn lỗi mức nghiêm trọng hoặc còn `[NEEDS CLARIFICATION]`.
- Tính năng phụ thuộc tính năng khác chỉ bắt đầu `plan` khi tính năng trước đã nghiệm thu (trừ khi backlog đánh dấu song song được).

### 3.4 Tài liệu `docs/` phục vụ SDD thế nào

- **D1 PRD** → nguồn user story và AC cho `specify`.
- **D3–D6, D8, D9** → nguồn `data-model.md` và `contracts/`; phần dùng chung tách ra `docs/contracts/` dưới dạng JSON Schema/TS type để code sinh type và test kiểm.
- **D2** → kết quả spike thay các giá trị `[chờ Sx]`; `research.md` của tính năng trích dẫn báo cáo spike thay vì nghiên cứu lại.
- **D10** → danh mục màn hình, quy tắc UI chung, hợp đồng IPC cho tính năng UI.
- **`feature-notes/`** → chi tiết đã bàn cho `spec.md` (workflow, thuật toán, tương tác); sau khi `spec.md` được duyệt, ghi chú tương ứng coi như đã thay thế.
- **`tech-defaults.md`** → lựa chọn mặc định cho `plan.md`/`research.md`.
- **D11, D12** → tiêu chuẩn trace/log và test mà mọi `plan.md` phải theo.
- **D13** → dùng khi tính năng là gói mở rộng (workflow, provider) thay vì sửa lõi.

### 3.5 Đổi spec khi đang triển khai

1. Phát hiện (khi `clarify`/`analyze`/implement, hoặc do kết quả spike, hoặc dùng thật) → ghi vào mục *Đề xuất đổi spec* của tính năng.
2. Sửa tài liệu `docs/` liên quan (tăng phiên bản, ghi ngày); nếu đụng hợp đồng: tăng `schema_version` + migration.
3. Chạy lại `analyze` cho các tính năng đang mở bị ảnh hưởng; cập nhật `spec.md`/`plan.md`/`tasks.md`.
4. Sửa code + test. Không sửa code trước bước 2.

### 3.6 `CLAUDE.md` ở gốc repo

```markdown
# StudioFlow Agent — hướng dẫn cho Claude Code

Dự án theo Spec-Driven Development. Trước mọi việc:
1. Đọc `.specify/memory/constitution.md` và `docs/README.md`.
2. Đọc spec tính năng đang làm trong `specs/NNN-*/` và các mục `docs/` nó trích dẫn.
3. Không tự đoán: gặp chỗ chưa rõ hoặc mâu thuẫn giữa code và spec thì dừng, ghi `[NEEDS CLARIFICATION]` và hỏi.
4. Test trước, code sau. Mọi ghi file của app đi qua Gateway.
5. Không định nghĩa lại schema/tool/manifest — dùng `docs/contracts/`.
6. Commit ghi số tính năng và mã FR/AC.
Nền tảng: Windows 11 x64, Electron + React (TS), lõi TS/Node, worker Python.
```

## 4. Backlog tính năng (đề xuất)

Thứ tự triển khai theo giai đoạn; cột **Phủ** là mã yêu cầu trong PRD. Danh sách được tinh chỉnh khi viết xong D3–D13.

| Số | Tính năng | Phủ | Dựa trên | Phụ thuộc |
|---|---|---|---|---|
| **M0** | | | | |
| 001 | `repo-scaffold`: monorepo 3 project, CLI `sf`, lint/test, đóng gói Windows | NFR-09 | constitution, D12 | — |
| 002 | `domain-artifacts`: mô hình miền, schema artifact, ID, cấu hình theo tầng, migration | FR-WS-01/03/05, FR-OB-02 | D3 | 001 |
| 003 | `gateway-core`: MCP server, `artifact.*`, `script.run`, chính sách ghi/lệnh/mạng | FR-CH-06, NFR-01 | D4, D5 | 002 |
| 004 | `job-cache-provenance-graph-basic`: job queue, cache theo nội dung, provenance, build graph cơ bản (nút `audio.line`, `asr.line`, `audio_meta`, `captions`, `frame_timing`, `index` + lan truyền lỗi thời) | FR-OP-01/03, FR-VO-04 | D4 | 003 |
| 005 | `agent-runtime-claude`: Agent Runtime Port + adapter Claude Agent SDK, plugin local | FR-CH-01/05 | D5 | 003 |
| 006 | `tts-omnivoice`: worker Python, `voice.profile`, `tts.synthesize`, `audio_meta.json`, CLI `sf video create`, `sf tts say` (đường kiểm AC-M0-01..03) | FR-VO-01/02/04, AC-M0-01..03 | D4 | 004, 005 |
| **M1** | | | | |
| 007 | `workflow-engine`: manifest, gate, điểm duyệt, `state.json`, khôi phục | FR-WF-01..04, FR-WS-04 | D6 | 004, 005 |
| 008 | `desktop-shell-chat`: chat, explorer chỉ đọc, tiến độ workflow, job panel | FR-CH-02/03/07, FR-WS-02 | D10, FN-008 | 005, 007 |
| 009 | `text-providers-refine-loop`: `text.generate`/`text.review`, bố cục `profile/` + nạp gói prompt, `refine-loop` | FR-SC-01..06, AC-M1-02 | D6 | 007 |
| 010 | `asr-align-captions`: `asr.align`, kiểm đọc sai, `caption_groups.json` | FR-VO-03, FR-CP-02 | D4, FN-common | 006 |
| 011 | `hyperframes-adapter-frame-build`: adapter, sub-agent frame, lắp `index.html`, transition, thư viện asset cơ bản (`asset.import`, `asset.search`, `assets/manifest.json`) | FR-CP-01/03, FR-IM-01 | D4, D6 | 007 |
| 012 | `music-library-basic`: nạp, phân tích, tìm theo BPM/tag, ducking, CREDITS | FR-MU-01/02/03/05/06, AC-M1-04 | D8, FN-012/021 | 004 |
| 013 | `render`: render nháp/phát hành, output profile | FR-RD-01..03 | D4 | 011 |
| 014 | `model-manager-install`: tải model theo yêu cầu, hồ sơ cài đặt, onboarding, Credential Manager | FR-OP-04/07, AC-M1-06 | D4, D10, FN-014 | 001 |
| 015 | `observability-local`: trace SQLite, màn xem trace | FR-OB-01 | D11 | 003 |
| 016 | `workflow-narrated-explainer` | FR-WF-05, AC-M1-01/03/05 | D6, FN-016, FN-common | 009–013 |
| 017 | `studio-preview`: nhúng Studio chế độ xem | FR-ST-01 | D9 | 011 |
| **M2** | | | | |
| 018 | `image-comfyui-qwen`: vòng đời ComfyUI, Qwen-Image-2.1, provider 2.0 API | FR-IM-02..04, FR-OP-05 | D4, FN-018 | 004 |
| 019 | `gpu-scheduler-phases` | FR-OP-02 | D4 | 018 |
| 020 | `build-graph-full`: đủ loại nút (`asset`, `frame_html`, `lipsync.line`, `credits`, `render`), nút ghim, `graph.plan` có ước tính | AC-M2-02/03 | D4 | 004, 011 |
| 021 | `music-clap-search` | FR-MU-04, AC-M2-04 | D8, FN-012/021 | 012 |
| 022 | `channel-profile-validate`: `channel.validate`, thư viện asset đầy đủ dùng lại giữa video | FR-IM-05, AC-M2-05 | D6 | 009, 011 |
| 023 | `workflow-story-documentary` + `refine-loop` storyboard | FR-WF-06, FR-SC-07, AC-M2-01/06 | D6, FN-023 | 018–022 |
| 024 | `disk-management` | FR-OP-06 | D4, D10, FN-024 | 004 |
| **M3** | | | | |
| 025 | `studio-commit`: bản làm việc, lọc diff, read-back, file watcher | FR-ST-02..04/06, FR-WS-06, AC-M3-01/02 | D9 | 017, 020 |
| 026 | `caption-panel` | FR-ST-05, AC-M3-03 | D9, D10, FN-026 | 010 |
| 027 | `finishing-look-effects-overlays` | FR-CP-04/05 | D6, FN-common | 011 |
| 028 | `cost-report-phoenix` + chọn ngữ cảnh từ preview | FR-OB-03/04, FR-CH-04, AC-M3-04 | D10, D11, FN-028 | 015 |
| **M4** | | | | |
| 029 | `workflow-essay-audiobook` | FR-WF-07 | D6, FN-029 | 023 |
| 030 | `workflow-shorts` | FR-WF-07 | D6, FN-030 | 023 |
| **M5** | | | | |
| 031 | `workflow-short-film`: cast, nhiều giọng, animatic | FR-WF-08, FR-VO-05 | D6, FN-031/032 | 023 |
| 032 | `lipsync-level1` | FR-WF-09 | D6, FN-031/032 | 031 |
| **Sau M5** | | | | |
| 033 | `voice-design`: giọng gợi ý từ mô tả (OmniVoice Voice Design) cho người dẫn và nhân vật | FR-VO-06 | D4 | 006, 031 |
| 034 | `autopilot`: chế độ tự động — agent điều phối, chỉ dừng ở điểm chốt | FR-WF-10 | D3, D5, D6 | 007, 033 |

Tính năng trong cùng giai đoạn không phụ thuộc nhau CÓ THỂ làm song song.
