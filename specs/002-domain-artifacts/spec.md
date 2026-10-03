# Feature Specification: Domain & Artifacts (mô hình miền, schema, ID, cấu hình, migration)

**Feature Branch**: `002-domain-artifacts`

**Created**: 2026-10-03

**Status**: Draft

**Input**: Backlog `docs/README.md` mục 4, dòng 002: "domain-artifacts: mô hình miền, schema artifact, ID, cấu hình theo tầng, migration".

**Phủ yêu cầu**: FR-WS-01, FR-WS-03, FR-WS-05, FR-OB-02 (định dạng provenance), một phần FR-SC-05 (định dạng beat/line của `SCRIPT.md`), NFR-01 (đường ghi duy nhất, nguyên tử, sao lưu), NFR-02 (ghi nguyên tử).

**Dựa trên `docs/`**: `03-spec-domain-artifacts.md` (D3, toàn bộ) · `04-spec-capability-gateway.md` mục 12 (CLI `sf artifact …`, `sf config resolve`) · `README.md` mục 2 (registry mã lỗi `docs/contracts/errors.json`) · constitution Điều V, VI · `tech-defaults.md` mục 7 (giá trị mặc định khóa cấu hình, không ràng buộc).

## Bối cảnh & mục tiêu

Mọi tính năng sau đọc/ghi cùng một bộ artifact (SCRIPT, STORYBOARD, state, audio_meta…). Tính năng này biến các định nghĩa TypeScript chuẩn trong D3 thành **hợp đồng máy kiểm được** (`docs/contracts/`), một **thư viện miền** trong `packages/core` (parse/ghi lại Markdown có khối dữ liệu, kiểm schema, ID, cấu hình theo tầng, migration) và **module ghi** duy nhất (ghi nguyên tử, sao lưu, chặn đường dẫn ra ngoài) mà Gateway (003) sẽ bọc thành tool.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mở thư mục làm kênh (Priority: P1)

Người dùng (qua app hoặc CLI) chọn một thư mục. Nếu có `channel.json` hợp lệ → nhận là kênh. Nếu không → được đề nghị khởi tạo: tạo `channel.json`, `profile/` mẫu và các thư mục con theo D3 mục 1.

**Why this priority**: Mọi luồng bắt đầu từ kênh (FR-WS-01).

**Independent Test**: Gọi API nhận diện trên thư mục trống, thư mục có `channel.json` hợp lệ, và thư mục có `channel.json` hỏng.

**Acceptance Scenarios**:

1. **Given** thư mục có `channel.json` hợp lệ, **When** mở, **Then** nhận diện là kênh và trả `ChannelConfig`.
2. **Given** thư mục trống, **When** mở, **Then** trả trạng thái "chưa là kênh" (không tự ghi gì); **When** người dùng đồng ý khởi tạo với tên + ngôn ngữ, **Then** có `channel.json` hợp lệ (ID `ch_` mới), `profile/` và các thư mục con.
3. **Given** `channel.json` sai schema, **When** mở, **Then** báo `E_SCHEMA_INVALID` kèm đường dẫn trường, không ghi đè file.

---

### User Story 2 - Tạo nhiều video trong một kênh (Priority: P1)

Trong một kênh, tạo video mới → thư mục `videos/<vd>/` với `state.json` (`phase: 'briefing'`, `workflow: null`, `output_profile: null`). Tạo nhiều lần → nhiều video, ID không trùng.

**Why this priority**: FR-WS-03; là điểm vào của mọi workflow.

**Independent Test**: Tạo 3 video trong kênh mẫu, kiểm cấu trúc thư mục, `state.json` hợp lệ schema, ID khác nhau.

**Acceptance Scenarios**:

1. **Given** kênh hợp lệ, **When** tạo video (có/không tiêu đề), **Then** có `videos/<vd>/state.json` hợp lệ với `phase: 'briefing'` và `BRIEF.md` khởi đầu có `video_id` đúng.
2. **Given** đã có video, **When** tạo thêm, **Then** ID mới không trùng ID nào trong kênh.

---

### User Story 3 - Đọc, kiểm và ghi lại artifact (Priority: P1)

Thư viện đọc được mọi artifact của D3: Markdown có front matter + marker/khối `sf-*` (`BRIEF.md`, `SCRIPT.md`, `STORYBOARD.md`, `CAST.md`, `STORY.md`, `publish.md`) và JSON (`state.json`, `audio_meta.json`, `caption_groups.json`, `caption-overrides.json`, `lipsync/*.json`, `reviews/*`, `provenance/*`, `assets/manifest.json`, `render.json`, `channel.json`, `settings.json`, `output.json`). Kiểm schema trả lỗi kèm đường dẫn trường. Ghi lại Markdown chỉ thay khối dữ liệu, giữ nguyên văn xuôi (round-trip). Line/beat mới chưa có ID được gán ID khi ghi.

**Why this priority**: Đây là hợp đồng mà mọi tính năng sau dựa vào (Điều V).

**Independent Test**: Bộ file mẫu hợp lệ/không hợp lệ cho từng artifact; parse → serialize → so byte với bản gốc; sửa chữ một line → chỉ dòng đó đổi, ID giữ nguyên.

**Acceptance Scenarios**:

1. **Given** file mẫu hợp lệ của mỗi loại artifact, **When** kiểm, **Then** `valid: true`.
2. **Given** artifact thiếu trường bắt buộc/sai kiểu, **When** kiểm, **Then** `E_SCHEMA_INVALID` với đường dẫn trường (ví dụ `/lines/0/duration_ms`).
3. **Given** `SCRIPT.md` có văn xuôi quanh marker, **When** parse rồi ghi lại không đổi, **Then** nội dung giống hệt byte (sau chuẩn hóa xuống dòng `\n`).
4. **Given** `SCRIPT.md` có line/beat mới không có `id`, **When** chuẩn bị ghi, **Then** được gán ID mới đúng định dạng và trả danh sách ID đã gán.
5. **Given** marker `sf:line` sai cú pháp hoặc khối `sf-frame` YAML hỏng, **When** parse, **Then** `E_PARSE_MARKER` kèm số dòng.
6. **Given** `STORYBOARD.md` tham chiếu `line_id` không có trong `SCRIPT.md`, hoặc một line nằm ở hai frame, **When** kiểm chéo, **Then** `E_ID_UNKNOWN` / lỗi ràng buộc tương ứng; ID trùng trong phạm vi → `E_ID_DUPLICATE`.

---

### User Story 4 - Giải cấu hình theo tầng (Priority: P1)

Hỏi giá trị một khóa cấu hình cho (kênh, video?, scene?, frame?) → nhận giá trị và nguồn (`default|app|channel|video|scene|frame`). Đặt khóa ở tầng không cho phép bị từ chối.

**Why this priority**: Tool `config.resolve`, template hồ sơ kênh, UI dùng chung (D3 mục 7.3).

**Independent Test**: Kênh mẫu đặt `look.id` ở channel, video, scene, frame; giải ở từng phạm vi; khóa lạ; khóa đặt sai tầng.

**Acceptance Scenarios**:

1. **Given** khóa chỉ có mặc định, **When** giải, **Then** `source: 'default'` và giá trị mặc định.
2. **Given** khóa đặt ở app, channel, video, scene, frame, **When** giải với phạm vi tới frame, **Then** tầng sâu nhất thắng và `path` chỉ file nguồn.
3. **Given** `output.profile` của video, **When** giải, **Then** đọc từ `state.json.output_profile`.
4. **Given** khóa không có trong bảng D3 mục 7.2, **When** giải hoặc đặt, **Then** `E_CONFIG_UNKNOWN_KEY`.
5. **Given** khóa ở tầng không cho phép (ví dụ `frame_build.parallel` trong `channel.json`), **When** đặt hoặc khi kiểm file, **Then** `E_CONFIG_SCOPE`.
6. **Given** CLI `sf config resolve <key> --channel <dir> [--video] [--scene] [--frame]`, **When** chạy, **Then** in `ResolvedValue` theo quy ước CLI.

---

### User Story 5 - Ghi an toàn qua một đường duy nhất (Priority: P1)

Mọi ghi vào kênh/video đi qua module ghi: kiểm schema trước khi ghi, ghi nguyên tử (tạm → fsync → đổi tên), từ chối đường dẫn ra ngoài phạm vi, ghi nhật ký `(path, hash, by, ts)`, sao lưu trước khi ghi đè artifact đã duyệt (theo `approvals`) hoặc frame đã ghim.

**Why this priority**: Constitution Điều VI, NFR-01/02.

**Independent Test**: Ghi hợp lệ; ghi sai schema; ghi `../ngoài`; ghi đè file đã duyệt → có bản sao lưu; giết tiến trình giữa lúc ghi lặp lại → không file đích nào hỏng.

**Acceptance Scenarios**:

1. **Given** nội dung hợp lệ, **When** ghi, **Then** file đích có nội dung mới, trả `hash` sha256, nhật ký có một dòng.
2. **Given** nội dung sai schema, **When** ghi, **Then** `E_SCHEMA_INVALID`, file đích không đổi.
3. **Given** đường dẫn tuyệt đối, có `..` thoát ra ngoài, hoặc symlink ra ngoài, **When** ghi, **Then** `E_PATH_OUTSIDE`, không tạo file nào.
4. **Given** artifact nằm trong `artifact_hashes` của một approval `approved`, **When** ghi đè, **Then** bản cũ được chép vào `.sf/backups/<ISO>/<path>` trước; giữ tối đa 20 bản mỗi file.
5. **Given** tiến trình bị giết giữa lúc ghi (lặp nhiều lần), **When** đọc lại file đích, **Then** file là bản cũ hoặc bản mới đầy đủ, không bao giờ dở dang.

---

### User Story 6 - Migration khi mở project cũ (Priority: P2)

Khi mở video có artifact `schema_version` cũ hơn bản app hỗ trợ: sao lưu → chạy lần lượt migration → kiểm schema → ghi. Phiên bản mới hơn app → chế độ chỉ đọc, `E_SCHEMA_TOO_NEW`. CLI `sf artifact migrate <video_dir> [--dry-run]`.

**Why this priority**: FR-WS-05; hiện mọi artifact ở phiên bản 1 nên chỉ cần khung + test với migration mẫu.

**Independent Test**: Đăng ký migration giả 1→2 cho một artifact trong test; video mẫu v1 → chạy migrate → có backup, file thành v2 hợp lệ; dry-run không ghi; file v99 → `E_SCHEMA_TOO_NEW`.

**Acceptance Scenarios**:

1. **Given** artifact v1 và migration 1→2 đã đăng ký, **When** `migrate`, **Then** có bản sao lưu trong `.sf/backups/`, file mới là v2 và hợp lệ.
2. **Given** `--dry-run`, **When** chạy, **Then** báo danh sách file sẽ migrate, không ghi gì.
3. **Given** `schema_version` lớn hơn bản hỗ trợ, **When** mở/migrate, **Then** `E_SCHEMA_TOO_NEW` và không ghi.

---

### User Story 7 - Hợp đồng dùng chung trong `docs/contracts/` (Priority: P1)

`docs/contracts/` chứa: type TypeScript của D3, JSON Schema cho mỗi artifact sinh từ type đó, `errors.json` gộp mọi bảng mã lỗi trong D3–D11 (kèm mã của khung CLI). Code trong `core` dùng đúng các type/schema này; có kiểm tự động phát hiện lệch.

**Why this priority**: Điều V và CLAUDE.md mục 5 — từ sau 002 mọi tính năng dùng `docs/contracts/`.

**Independent Test**: Chạy bộ sinh → không có thay đổi so với bản đã commit; mọi interface trong D3 có trong type; mọi mã lỗi `E_*` dùng trong `packages/core/src` có trong `errors.json`.

**Acceptance Scenarios**:

1. **Given** repo sạch, **When** chạy lại bộ sinh hợp đồng, **Then** `git diff` rỗng.
2. **Given** một mã lỗi dùng trong code nhưng không có trong `errors.json`, **When** chạy contract test, **Then** fail và chỉ ra mã.
3. **Given** cùng mã lỗi xuất hiện ở hai tài liệu, **When** sinh `errors.json`, **Then** mã xuất hiện một lần, ghi đủ nguồn; `retryable` mặc định `false`.

### Edge Cases

- `SCRIPT.md` dùng CRLF: parse như LF; hash tính trên nội dung chuẩn hóa `\n`.
- Line không có đoạn văn sau marker (dòng trống ngay sau) → `E_PARSE_MARKER`.
- Marker có thuộc tính chứa dấu cách trong ngoặc kép (`direction="giọng run"`) và ký tự Unicode → giữ đúng.
- Front matter thiếu `schema_version` → `E_SCHEMA_INVALID`.
- Hai lần gán ID mới trong cùng file → không trùng nhau và không trùng ID có sẵn trong phạm vi.
- Tạo kênh trong thư mục đã có file khác (không có `channel.json`) → giữ file cũ, chỉ thêm phần thiếu.
- Ghi file nhị phân (wav) qua module ghi → cùng cơ chế nguyên tử, không kiểm schema.
- Đường dẫn chứa ký tự Unicode/khoảng trắng → hoạt động.
- Sao lưu thứ 21 của cùng file → bản cũ nhất bị xóa (chỉ trong `.sf/backups/`).

## Requirements *(mandatory)*

### Functional Requirements

**Hợp đồng (`docs/contracts/`)**

- **FR-001**: PHẢI có `docs/contracts/domain/types.ts` chứa nguyên văn các định nghĩa TypeScript của D3 mục 3–7 (một biểu diễn duy nhất), và `docs/contracts/domain/*.schema.json` sinh tự động từ đó cho mỗi artifact ở D3 mục 5–6.
- **FR-002**: PHẢI có `docs/contracts/errors.json` sinh từ bảng mã lỗi D3–D11 (+ mã khung CLI của 001); mỗi mã một mục `{code, retryable, sources[]}`; mã lỗi dùng trong `packages/core/src` PHẢI có trong registry (kiểm tự động).
- **FR-003**: Bộ sinh hợp đồng PHẢI xác định (chạy lại không đổi file) và có kiểm "hợp đồng đã sinh khớp nguồn" trong `verify`.

**ID**

- **FR-004**: PHẢI sinh ID dạng `<tiền tố>_<8 ký tự [0-9a-z]>` bằng nguồn ngẫu nhiên mật mã, cho đủ tiền tố D3 mục 2, và kiểm trùng trong phạm vi do người gọi cung cấp.
- **FR-005**: PHẢI kiểm định dạng ID theo tiền tố trong schema (ví dụ `line_id` phải là `ln_…`).

**Artifact**

- **FR-006**: PHẢI parse và serialize `BRIEF.md`, `SCRIPT.md`, `STORYBOARD.md`, `CAST.md`, `STORY.md`, `publish.md` theo D3 mục 5.1–5.6, 5.15, giữ nguyên văn xuôi (round-trip byte-đồng nhất khi không sửa).
- **FR-007**: Khi chuẩn bị ghi `SCRIPT.md`/`STORYBOARD.md`, PHẢI gán ID cho beat/line/scene/frame/layer chưa có ID và trả danh sách ID đã gán; sửa chữ một line giữ nguyên ID.
- **FR-008**: PHẢI kiểm schema mọi artifact ở D3 mục 5–6 và trả `{valid, errors[{path, message}]}`; lỗi cú pháp marker/khối → `E_PARSE_MARKER` kèm số dòng.
- **FR-009**: PHẢI kiểm ràng buộc chéo trong một video: ID duy nhất theo phạm vi (`E_ID_DUPLICATE`), tham chiếu tồn tại (`E_ID_UNKNOWN`), mỗi line thuộc đúng một frame.
- **FR-010**: PHẢI tính hash sha256 của nội dung (văn bản chuẩn hóa `\n`) theo D3 mục 8.

**Kênh & video**

- **FR-011**: PHẢI nhận diện kênh qua `channel.json` hợp lệ; thư mục không có → trạng thái "chưa là kênh", không ghi; khởi tạo theo yêu cầu tạo `channel.json`, `profile/` mẫu và thư mục con D3 mục 1 (FR-WS-01).
- **FR-012**: PHẢI tạo video: `videos/<vd>/`, `state.json` (`phase: 'briefing'`, `workflow: null`, `output_profile: null`, `owner: 'agent'`), `BRIEF.md` khởi đầu (FR-WS-03).

**Cấu hình**

- **FR-013**: PHẢI có bảng khóa cấu hình đúng D3 mục 7.2 (gồm khóa mẫu `<…>`) với kiểu và tầng cho phép; giá trị mặc định lấy theo tech-defaults mục 7.
- **FR-014**: PHẢI có `resolveConfig(key, scope)` theo D3 mục 7.3 với thứ tự app → channel → video → scene → frame; `output.profile` tầng video đọc từ `state.json`; khóa lạ → `E_CONFIG_UNKNOWN_KEY`; sai tầng → `E_CONFIG_SCOPE`; giá trị sai kiểu → `E_SCHEMA_INVALID`.
- **FR-015**: PHẢI có thao tác đặt khóa ở tầng `channel` hoặc `video` (nền cho tool `config.set`) đi qua module ghi.

**Module ghi (nền cho Gateway)**

- **FR-016**: PHẢI có module ghi là đường duy nhất để ghi vào kênh/video: kiểm phạm vi (`E_PATH_OUTSIDE` cho tuyệt đối, `..`, symlink/junction ra ngoài), kiểm schema với artifact có schema, ghi nguyên tử, trả hash.
- **FR-017**: Module ghi PHẢI ghi nhật ký `(path, hash, by, ts)` truy vấn được.
- **FR-018**: Module ghi PHẢI sao lưu bản cũ vào `.sf/backups/<ISO>/<path>` trước khi ghi đè artifact có trong một approval `approved` hoặc file của frame đã ghim, và trước migration; giữ 20 bản gần nhất mỗi file.
- **FR-019**: Không có code nào khác trong `packages/core/src` gọi API ghi file của Node lên kênh/video ngoài module ghi (kiểm tĩnh trong test).

**Migration**

- **FR-020**: PHẢI có khung migration: registry `migrate_<artifact>_<n>_to_<n+1>` (hàm thuần), chạy lần lượt tới phiên bản hiện tại, sao lưu trước, kiểm schema sau; phiên bản lớn hơn → `E_SCHEMA_TOO_NEW` và chế độ chỉ đọc (FR-WS-05).

**CLI**

- **FR-021**: PHẢI có `sf artifact validate <path>`, `sf artifact migrate <video_dir> [--dry-run]`, `sf config resolve <key> --channel <dir> [--video <id>] [--scene <id>] [--frame <id>]` theo quy ước D4 mục 12.

### Key Entities

Toàn bộ thực thể ở D3 mục 3–7 (Beat, Line, Scene, Frame, Layer, AssetRequest, CastMember, OutputProfile, các artifact mục 5, ChannelConfig, SettingsConfig, ConfigKey/ResolvedValue). Riêng của tính năng: **WriteLogEntry** `(path, hash, by, ts)`; **Migration** `(artifact, from, to, fn)`.

## Success Criteria *(mandatory)*

- **SC-001**: 100% artifact ở D3 mục 5–6 có schema và ít nhất một file mẫu hợp lệ + một file mẫu không hợp lệ trong contract test.
- **SC-002**: Round-trip parse → serialize của mọi file mẫu Markdown cho kết quả byte-đồng nhất.
- **SC-003**: 1 000 lần giết tiến trình giữa lúc ghi (tech-defaults mục 6) → 0 file đích hỏng.
- **SC-004**: Chạy lại bộ sinh hợp đồng → 0 file đổi; 0 mã lỗi trong code thiếu ở registry.
- **SC-005**: Độ phủ dòng `packages/core` giữ ≥ 80%.

## Phạm vi

**Trong phạm vi**: `docs/contracts/` (types, schema, errors), thư viện miền trong `packages/core/src/domain`, module ghi `packages/core/src/store`, cấu hình theo tầng, khung migration, nhận diện/khởi tạo kênh, tạo video (API), 3 lệnh CLI ở FR-021.

**Ngoài phạm vi**: tool MCP `artifact.*`/`config.*` và chính sách phiên (003), kiểm `owner`/`base_hash`/`allowed_paths` (003), build graph và cache (004), `sf video create` (006), file watcher (025), nội dung `profile/` thật (009/022), IPC `video.create` (008).

## Assumptions

- Mọi artifact hiện ở `schema_version: 1`; chưa có migration thật — khung được kiểm bằng migration giả trong test.
- `frame.md` sinh từ HyperFrames `[chờ S3]`: 002 chỉ kiểm front matter (`schema_version`, `generated_from`), không kiểm thân.
- Mặc định `text.producer/critic/aux` phụ thuộc khóa API (D4 mục 4.3) nên ở 002 không có giá trị tĩnh (`value: null`, `source: 'default'`); giải động thuộc 009.
- `ManualDelta`/frame ghim: 002 chỉ cần nhận diện file của frame đã ghim (`compositions/frames/<frame_id>.html`) để sao lưu.
- Module ghi ở 002 không áp `owner`/`base_hash`/`allowed_paths` (thuộc 003) nhưng có điểm móc để 003 thêm kiểm tra.
