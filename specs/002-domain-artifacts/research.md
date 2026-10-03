# Research — 002 domain-artifacts

## R1. "Sinh từ D3" thay vì chép tay
- **Decision**: `scripts/gen-contracts.mjs` trích mọi khối TS trong D3 mục 3–7 theo thứ tự, thêm `export`, đổi `function` → `export declare function`, ghi `docs/contracts/domain/d3.ts`. Bảng D3 mục 7.2 được parse thành `config-keys.json` + union `ConfigKey` (khóa `<…>` → template literal).
- **Rationale**: D3 nói định nghĩa TS trong tài liệu là chuẩn; trích tự động bảo đảm không có hai định nghĩa (Điều V); `--check` phát hiện lệch.
- **Alternatives**: chép tay `types.ts` (dễ lệch).

## R2. Front matter Markdown
- **Decision**: `docs/contracts/domain/markdown.ts` định nghĩa front matter của `BRIEF.md`, `SCRIPT.md`, `STORYBOARD.md`, `STORY.md`, `CAST.md`, `publish.md`, `frame.md` và khối `sf-story` theo ví dụ/mô tả D3 5.2–5.6, 5.15. D3 chỉ cho ví dụ YAML, không có khối TS.
- **Đề xuất đổi spec** (không chặn): thêm khối TS cho các front matter này vào D3 lần sửa sau để `markdown.ts` cũng được trích tự động.

## R3. Schema
- **Decision**: `ts-json-schema-generator`, hậu xử lý pattern ID: `^ch_.*$` → `^ch_[0-9a-z]{8}$` (D3 mục 2). Ajv 8 (`allErrors`) + `ajv-formats`.
- **Ghi chú**: `AudioMeta.lines[].asr_regen_count` nằm trong chú thích ở D3 5.7 nên không phải trường; 010 cần bộ đếm sinh lại sẽ nêu đề xuất đổi spec khi tới.

## R4. Parser Markdown
- **Decision**: parser theo dòng, giữ mảng dòng gốc; serialize chỉ thay dòng của marker/khối đã đổi. YAML của khối dùng `yaml`. Khối/marker không đổi giữ nguyên byte.
- **Alternatives**: remark/mdast (không round-trip byte-đồng nhất).

## R5. Ghi nguyên tử trên Windows
- **Decision**: file tạm `<root>/.sf/tmp/<uuid>` (cùng ổ), `open → write → fsync → close → rename`; `rename` thử lại tối đa 5 lần khi `EPERM/EBUSY/EACCES` (antivirus/indexer). `root` = thư mục video nếu đích nằm trong video, ngược lại thư mục kênh.
- **Chặn ra ngoài**: từ chối tuyệt đối/`..`; `realpath` của thư mục cha tồn tại gần nhất phải nằm trong `realpath(root kênh)` (chặn symlink/junction).

## R6. Nhật ký ghi
- **Decision**: trong bộ nhớ (`WriteStore.log`, giới hạn 10 000 mục). Người dùng là file watcher cùng tiến trình (D9 mục 3.6, tính năng 025).

## R7. Giá trị mặc định cấu hình
- **Decision**: `src/config/defaults.ts` theo tech-defaults mục 7; `provider.<capability>` theo D4 mục 4.3; `text.producer/critic/aux` → `null` (động, 009); `voice.id` → `null`. Khóa mẫu có bảng con; phần tử không có → `null`.

## R8. Kill test
- **Decision**: tiến trình con ghi lặp một file qua `WriteStore`; cha giết sau 5–60 ms ngẫu nhiên, kiểm file đích là JSON đầy đủ của một phiên bản. `SF_KILL_ITER` mặc định 50 trong `verify`; nghiệm thu chạy 1 000 (SC-003).

## R9. Tạo kênh
- **Decision**: mẫu `profile/` (plugin.json, `skills/channel/SKILL.md`, `references/style-guide.md`, `references/preferences.md`) ở `packages/core/templates/channel/`; gói prompt thật thuộc 009. Chỉ thêm file còn thiếu, không ghi đè.
