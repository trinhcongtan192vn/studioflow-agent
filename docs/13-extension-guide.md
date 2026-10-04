# D13 — Hướng dẫn mở rộng

**Phiên bản:** 1.0 · **Ngày:** 03/10/2026
**Dựa trên:** `00-architecture.md` mục 13 · D4, D6 · **Phủ:** NFR-08, G4

Cách thêm khả năng mới **không sửa lõi/UI**. Mỗi loại gói có manifest, được `sf ext validate` kiểm khi cài và trong CI.

---

## 1. Manifest chung

Mọi gói có trường: `id`, `version` (semver), `app_api` (semver range), `requires` (capability/gói khác), và với gói dựa HyperFrames/ComfyUI: `hyperframes_version` / `comfyui_version` (range). Gói không tương thích bị vô hiệu hóa kèm thông báo (`E_WORKFLOW_INCOMPATIBLE` hoặc `E_EXTENSION_INCOMPATIBLE`).

Vị trí: gói đi kèm bản cài ở `<install>/resources/extensions/<loại>/<id>/` (chỉ đọc); gói người dùng thêm (Cài đặt → Gói mở rộng) ở `<app-data>/extensions/<loại>/<id>/`, ưu tiên khi trùng `id`.

## 2. Thêm thể loại video (gói workflow)

1. Tạo `extensions/workflows/<id>/` theo D6 mục 1.1.
2. Nếu dựa trên workflow HyperFrames: chép upstream ghim vào `upstream/`, viết `delta/` (D6 mục 8), chạy `sf ext build`.
3. Viết `workflow.yaml` chỉ dùng bước trong thư viện (D6 mục 2). Cần bước mới → đó là thay đổi lõi (mục 4), không làm trong gói.
4. Viết `skills/<id>/SKILL.md`: mỗi bước do agent thực hiện có một mục "Bước <id>" mô tả đầu vào, đầu ra, quy tắc nghề, ví dụ.
5. Rubric mặc định trong `rubrics/`.
6. Dự án mẫu `samples/` (D12 mục 3) + bản ghi LLM.
7. `sf ext validate` → `sf test e2e --workflow <id>`.

**Không sửa:** lõi, UI, Gateway. UI tự hiện workflow mới từ manifest.

## 3. Thêm provider (model mới cho capability có sẵn)

1. `extensions/providers/<id>/provider.yaml` (D4 mục 4.1).
2. Adapter TypeScript cài `ProviderAdapter<I,O>` (D4 mục 4.2) — export mặc định từ `adapter.ts`.
3. Theo runtime:
   - `python-worker`: thêm engine Python cài các phương thức JSON-RPC (D4 mục 9.3), `requirements.lock`.
   - `comfyui`: workflow JSON có placeholder (D4 mục 9.2), danh sách custom node + model ghim.
   - `cloud`: khai báo tên khóa bí mật cần (`secrets: [openai]`) và domain vào danh sách mạng.
4. Model vào `models.yaml` với `install_profile`.
5. Test contract của capability chạy với provider mới; e2e workflow liên quan.
6. Người dùng chọn qua Cài đặt (UI-09) hoặc `provider.<capability>` trong `channel.json`.

**LLM viết/critic mới:** provider `text.<id>` với `capabilities: [text.generate, text.review]`; có thể cần chỉnh gói prompt kênh.

## 4. Thêm tác vụ mới (capability mới) — có sửa lõi
1. Viết hợp đồng trong D4 mục 3 (tăng phiên bản tài liệu) + `docs/contracts/`.
2. Thêm tool Gateway (D4 mục 2.4) + chính sách theo kind (D5 mục 4).
3. Thêm loại nút build graph nếu tạo artifact (D4 mục 8).
4. Thêm bước thư viện nếu workflow cần (D6 mục 2).
5. Provider đầu tiên (mục 3). Hồi quy toàn bộ.

## 5. Blueprint `extensions/blueprints/<pack>/<id>/`
- `blueprint.html`: sub-composition HyperFrames có biến `{{var}}`; mọi phần tử chính có `data-sf-id="{{el.<tên>}}"` để engine gán ID.
- `blueprint.yaml`: `id`, `title`, `vars` (tên, kiểu, mặc định), `layers` (tên lớp → `kind`), `editable` (thuộc tính Studio được sửa — bổ sung vào danh sách cho phép D9 mục 3.3, không vượt ngoài nhóm cho phép ở đó), `min_duration_ms`, `aspect`.
- Keyframe dạng dữ liệu `data-sf-keyframes` theo D9 mục 3.4 (a).
- Ảnh xem trước `preview.png`.

## 6. Gói phong cách `extensions/styles/<id>/`
`style.yaml` + tài nguyên: `image_prompt` (đoạn mô tả phong cách nối sau prompt khi sinh ảnh theo look, 018), caption skin (id thành phần catalog + biến), preset overlay, bộ miệng `mouths/<set>/<view>/{closed,half,open}.svg`, LUT `.cube`, preset transition. Kênh tham chiếu bằng id qua khóa cấu hình (`caption.style`, `look.id`, `overlay.rules`…).

## 7. Output profile `extensions/outputs/<id>/output.json`
Theo `OutputProfile` (D3 mục 4); có thêm `id`, `version`, `app_api`. Test: render dự án mẫu với profile mới, kiểm vùng an toàn bằng snapshot.

## 8. Hồ sơ kênh mới
1. Tạo kênh trong app (UI-02) — agent dẫn dắt tạo `channel.json` và `profile/` từ mẫu.
2. Bổ sung `style-guide.md`, gói prompt, rubric riêng, blueprint riêng nếu cần.
3. `channel.validate` (D6 mục 6.3) + chạy một video mẫu.

## 9. Checklist đóng gói

- [ ] Manifest hợp lệ (`sf ext validate`)
- [ ] `app_api` và phiên bản HyperFrames/ComfyUI khai báo đúng
- [ ] Skill khớp manifest (mọi bước agent có mục trong `SKILL.md`)
- [ ] Không nhắc tên model trong skill
- [ ] Dự án mẫu + bản ghi LLM; e2e pass
- [ ] Test contract (provider) pass; test `gpu` pass trên máy tham chiếu nếu dùng GPU
- [ ] Cập nhật bảng provider/workflow trong tài liệu liên quan
