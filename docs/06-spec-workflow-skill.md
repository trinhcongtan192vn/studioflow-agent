# D6 — Spec workflow, skill, `refine-loop`, hồ sơ kênh

**Phiên bản:** 1.3 · **Ngày:** 03/10/2026
**Dựa trên:** `00-architecture.md` mục 7.2, 8 · D3, D4, D5
**Phủ:** FR-WF-01..04, FR-WS-04, FR-SC-01..07, FR-CP-01, FR-RD-03, NFR-08, AC-M1-02, AC-M2-05
**Tính năng triển khai:** 007 `workflow-engine`, 009 `text-providers-refine-loop`, 011 (frame packet), 022 `channel-profile-validate`

---

## 1. Gói workflow

### 1.1 Bố cục (là một plugin Agent SDK)

```
extensions/workflows/<workflow-id>/
  .claude-plugin/plugin.json      { "name": "wf-<workflow-id>", "version": "<semver>" }
  workflow.yaml                   manifest cho Workflow Engine (mục 1.2)
  skills/<workflow-id>/SKILL.md   hướng dẫn agent theo bước
  skills/<workflow-id>/references/
  upstream/                       bản sao chỉ đọc workflow/skill HyperFrames ghim (mục 8)
  delta/                          khác biệt so với upstream (mục 8)
  scripts/                        script của gói (chạy qua script.run)
  rubrics/                        rubric mặc định (mục 4.3)
  samples/<sample-id>/            dự án mẫu cho hồi quy (D12)
```

### 1.2 `workflow.yaml`

```ts
interface WorkflowManifest {
  id: string; version: string; title: string; description: string;
  app_api: string;                          // semver range
  upstream?: { hyperframes_workflow: string; hyperframes_version: string };
  output_profiles: string[];                // cho phép; phần tử đầu là mặc định
  requires: string[];                       // capability bắt buộc
  optional?: string[];
  brief?: { questions: string[] };          // câu hỏi thêm cho router khi chốt brief (mục 3.0)
  scripts?: { id: string; command: string; args_schema?: object; writes?: string[] }[];
  steps: StepDecl[];                        // không gồm brief (brief là pha trước workflow)
}

type StepLibraryId = 'design-system' | 'script' | 'storyboard' | 'cast' | 'voice' | 'assets' | 'frame-build'
  | 'animatic' | 'captions' | 'music' | 'look' | 'effects' | 'overlays' | 'lipsync' | 'finalize' | 'publish-meta' | 'render';

interface StepDecl {
  id: string;                               // duy nhất trong workflow
  uses: StepLibraryId;
  title: string;
  after?: string[];                         // phụ thuộc; mặc định = bước trước
  params?: Record<string, unknown>;         // theo schema params của bước (mục 2)
  refine?: { enabled: boolean; rubric: string; min_rounds?: number; max_rounds?: number; threshold?: number };
  approval?: { required: boolean; summary_template?: string };
  gate?: GateDecl[];                        // thêm vào gate mặc định của bước
  skip_if?: { config: ConfigKey; equals: unknown } | { phase_before: 'M3' }; // điều kiện bỏ qua; ngữ pháp duy nhất
}

type GateDecl =
  | { kind: 'artifact_valid'; path: string }
  | { kind: 'graph_fresh'; nodes: string }  // ví dụ 'audio.line:*'
  | { kind: 'approved'; step: string }
  | { kind: 'script'; script: string }      // script trả exit 0 = qua
  | { kind: 'objective'; check: string; params?: Record<string, unknown> };   // mục 4.2
```

`skip_if: { phase_before: 'M3' }` dùng cho bước chưa có ở giai đoạn hiện tại của app (app khai báo hằng `APP_PHASE`).

Ví dụ rút gọn:

```yaml
id: narrated-explainer
version: 1.0.0
title: Video thuyết minh
app_api: ">=1.0 <2.0"
upstream: { hyperframes_workflow: faceless-explainer, hyperframes_version: "<ghim>" }
output_profiles: [yt-1080p30]
requires: [tts.synthesize, asr.align, render.video]
optional: [image.generate]
brief: { questions: ["Độ dài mục tiêu?"] }
steps:
  - { id: design, uses: design-system, title: Design system }
  - { id: script, uses: script, title: Kịch bản, params: { mode: narration }, refine: { enabled: true, rubric: script-default }, approval: { required: true } }
  - { id: storyboard, uses: storyboard, title: Storyboard, approval: { required: true } }
  - { id: voice, uses: voice, title: Giọng đọc }
  - { id: assets, uses: assets, title: Hình ảnh }
  - { id: look, uses: look, title: Look màu, skip_if: { phase_before: M3 } }
  - { id: frames, uses: frame-build, title: Dựng frame }
  - { id: effects, uses: effects, title: Hiệu ứng, skip_if: { phase_before: M3 } }
  - { id: overlays, uses: overlays, title: Overlay, skip_if: { phase_before: M3 } }
  - { id: captions, uses: captions, title: Phụ đề }
  - { id: music, uses: music, title: Nhạc nền }
  - { id: finalize, uses: finalize, title: Hoàn thiện, approval: { required: true } }
  - { id: meta, uses: publish-meta, title: Tiêu đề và mô tả, refine: { enabled: true, rubric: meta-default } }
  - { id: render, uses: render, title: Render, params: { mode: release } }
```

## 2. Thư viện bước

| Id | Thực hiện bởi | params | Đọc | Ghi | Gate mặc định |
|---|---|---|---|---|---|
| `design-system` | engine | — | `profile/`, `channel.json` | `frame.md` | hợp lệ |
| `script` | engine (`text.generate` + `refine-loop`) | `mode: 'narration' \| 'outline' \| 'screenplay'` (mặc định `narration`) | `BRIEF.md`, gói prompt; `screenplay` đọc thêm `STORY.md`, `CAST.md` | `outline` → `STORY.md`; khác → `SCRIPT.md` | hợp lệ; `SCRIPT.md`: mọi line có ID, qua `length`; `screenplay`: mỗi `speaker` có cast + voice |
| `storyboard` | agent (`producer` khi có refine, nếu không thì `main`) | — | `BRIEF.md`, `SCRIPT.md`, `frame.md`, blueprint | `STORYBOARD.md` | hợp lệ; **mỗi line thuộc đúng một frame**; mọi ID tham chiếu tồn tại |
| `cast` | agent (`main`) | — | `STORY.md` hoặc `BRIEF.md` | `CAST.md`, `characters/` | mỗi nhân vật trong `STORY.md` có cast + voice |
| `voice` | engine (`graph.build` nút `audio.line`, `asr.line`) | — | `SCRIPT.md`, `CAST.md` | `audio/`, `audio_meta.json` | `graph_fresh audio.line:*`; mọi line `asr_flag ∈ {ok, accepted}` (line còn `mismatch` sau `asr.max_regen` lần sinh lại → hỏi người dùng sửa chữ/chấp nhận) |
| `assets` | engine + agent | — | `STORYBOARD.md` (`asset_request`) | `public/`, `assets/manifest.json` | mọi layer có asset |
| `lipsync` | engine | — | `audio.line`, `CAST.md` | `lipsync/*.json` | — (bỏ qua khi `lipsync.enabled` = false) |
| `frame-build` | agent (`frame` × N) | — | frame packet | `compositions/frames/<fr>.html` | `lint`/`check` qua; `data-sf-id` đủ; mọi frame đã báo xong |
| `animatic` | engine | — | `STORYBOARD.md`, `audio_meta.json`, asset | `renders/<rd>/` với `mode: animatic` (khung tĩnh theo frame + audio) | — |
| `captions` | engine | — | `audio_meta.json`, `SCRIPT.md` | `caption_groups.json` | hợp lệ |
| `music` | agent (`main`) + engine | — | `sf-scene.music`, kho nhạc | `public/music/*`, cập nhật `sf-scene.music.track_id` | mỗi scene có `track_id` hoặc `music: none` |
| `look` / `effects` / `overlays` | agent (`main`) | — | hồ sơ kênh | `sf-scene.look`, `sf-frame.effects/overlays` | — |
| `finalize` | engine | — | toàn bộ | `index.html`, contact sheet `.sf/snapshots/` | `graph_fresh *`; thời lượng trong `check.duration_tolerance` của mục tiêu |
| `publish-meta` | engine (`text.generate` + `refine-loop`) | — | `BRIEF.md`, `SCRIPT.md` | `publish.md` | `meta_limits` |
| `render` | engine | `mode: 'draft' \| 'release'` | `index.html` | `renders/<rd>/` (+ `CREDITS.txt`, `description.txt` khi release) | gate phát hành (D4) khi `release` |

- **agent:** Engine gửi cho phiên một chỉ dẫn chuẩn `Thực hiện bước <id> của workflow <wf> theo skill. Đầu vào: … Đầu ra: …` và chờ `workflow.step_complete`. Quá `maxTurns` hoặc agent dừng mà chưa báo xong → bước `failed` (`E_STEP_INCOMPLETE`).
- **engine:** Engine tự gọi capability/graph, không cần agent.
- `publish.md`: D3 mục 5.15. `STORY.md`: D3 mục 5.3b.
- Thứ tự trong manifest phải tôn trọng phụ thuộc dữ liệu: `lipsync` trước `frame-build`; `cast` trước `script` mode `screenplay`. `sf ext validate` kiểm bằng bảng Đọc/Ghi ở trên.

## 3. Workflow Engine

### 3.0 Pha briefing (trước workflow)
1. `video.create` tạo video với `phase: briefing` (D3 mục 8).
2. Phiên `main` dùng skill router: hỏi người dùng (câu hỏi của skill router + `brief.questions` của workflow dự kiến), gọi `workflow.list`, chọn workflow, gọi `workflow.select`, ghi `BRIEF.md`.
3. Engine tạo approval cho brief. Duyệt → engine ghi `state.json.workflow`, `output_profile` từ đề xuất trong `BRIEF.md`, khởi tạo `steps` từ manifest, `phase: workflow`. Từ đây `state.json` là nguồn chính thức.
4. Đổi workflow sau khi đã vào pha `workflow` → quay về `briefing` (các bước cũ giữ file nhưng `state.json.steps` được tạo lại; hỏi người dùng trước).

### 3.1 Vòng đời bước

```
pending → running → (waiting_approval) → done
                 ↘ failed → (retry) running
done → stale   (khi đầu vào đổi sau đó)
```
- Bắt đầu bước khi mọi `after` ở `done` và gate của chúng qua.
- Sau khi chạy xong: kiểm gate; qua → nếu `approval.required` thì `waiting_approval`; không thì `done`.
- **Approval do engine tạo duy nhất** (kể cả bước có refine); bản ghi gồm `artifact_hashes`. Với bước agent thực hiện, agent CÓ THỂ gắn tóm tắt bằng `approval.annotate` trước khi báo xong; với bước refine, tóm tắt do engine sinh từ các vòng.
- **Duyệt:** `approved` → `done`; `changes_requested` + ghi chú → bước về `running` với ghi chú làm đầu vào (agent hoặc vòng refine mới).
- **Quay lại bước trước** (FR-WF-03, `workflow.rewind`): bước đích về `running`; mọi bước sau bị `stale`; approval của chúng mất hiệu lực khi hash artifact đổi.
- **Duyệt mất hiệu lực:** khi hash của artifact trong `Approval.artifact_hashes` đổi → approval chuyển `pending` lại, bước về `waiting_approval`.
- **Khôi phục (FR-WS-04):** khi mở video, engine đọc `state.json`; bước `running` của loại engine → tiếp tục theo job (D4 mục 5); của loại agent → đặt `pending` và hỏi người dùng có chạy lại không.

### 3.2 Điều phối tự động
Mặc định engine tự chạy liên tiếp các bước không cần duyệt; dừng ở điểm duyệt, lỗi, hoặc thẻ xác nhận (D5 mục 5.1). Lệnh qua chat ("chạy tới bước render", "dừng", "quay lại storyboard") được agent chuyển thành `workflow.run_to` / `workflow.pause` / `workflow.rewind`.

## 4. `refine-loop`

### 4.1 Thuật toán

```
input: step, artifact_path, producer_cfg, critic_cfg, rubric, min=2, max=3, threshold
reserve = estimate_cost(producer_cfg, critic_cfg) * min
if budget_remaining < reserve: ask_user(add_budget | run_once | cancel)
draft = producer.generate(prompt_pack[step], brief, notes)
for r in 1..max:
    checks = objective_checks(draft)                # 4.2, rẻ, không gọi LLM
    review = critic.review(draft, rubric, brief, prior_issues)   # phiên mới, ngữ cảnh mới
    record ReviewRound(r)
    stop = r >= min and review.score >= threshold and no critical/major issues and checks all pass
    if stop: break
    if r == max: break
    if budget exhausted: mark incomplete; ask_user(add_budget | accept | cancel); break
    draft = producer.revise(draft, review.issues, failing checks)   # cùng producer, giữ giọng kênh
write artifact (draft cuối) ; step.refine = {rounds, final_score, incomplete}
engine tạo approval kèm tóm tắt các vòng
```
- **Kiểm "khác model":** `critic.provider + model` ≠ `producer.provider + model`, nếu không → `E_REFINE_SAME_MODEL`. Khi cả hai là Claude (chưa có khóa ngoài) thì model phải khác tầng và tóm tắt ghi "critic cùng hãng".
- Producer cho `script`/`publish-meta`: `text.generate` vai `primary`. Producer cho `storyboard`: phiên `producer` (D5). Critic: `text.review` định tuyến theo artifact (kịch bản/tiêu đề → `text.claude`; storyboard → model ngoài, thiếu khóa thì Claude khác tầng).
- `min`, `max`, `threshold` lấy từ khóa `refine.*` (D3 mục 7.2), workflow có thể ghi đè trong `refine`.

### 4.2 Kiểm tra khách quan

| Id | Áp cho | Kiểm |
|---|---|---|
| `length` | script | tổng số từ lệch mục tiêu (`target_duration_ms` × `script.wpm.<lang>`) không quá `check.length_tolerance` |
| `read_time` | script | thời lượng đọc ước tính lệch mục tiêu không quá `check.duration_tolerance` |
| `beat_structure` | script | số beat trong khoảng hồ sơ kênh quy định; mỗi beat ≥ 1 line |
| `banned_terms` | script, meta | không chứa từ cấm của kênh |
| `tts_normalized` | script | số/viết tắt có `sf:tts` hoặc đã viết thành chữ |
| `schema` | mọi | artifact parse và hợp lệ |
| `coverage` | storyboard | mỗi line thuộc đúng một frame; mọi frame có ≥ 1 layer |
| `meta_limits` | meta | tiêu đề ≤ `meta.title_max`, mô tả ≤ `meta.description_max` ký tự |

### 4.3 Rubric `rubrics/<id>.yaml`

```ts
interface Rubric { id: string; version: number; scale: 10;
  criteria: { id: string; weight: number; prompt: string }[];   // Σ weight = 1
  severity_rules: string; }
```

```yaml
id: script-default
version: 1
scale: 10
criteria:
  - { id: hook, weight: 0.2, prompt: "30 giây đầu có giữ người xem không?" }
  - { id: clarity, weight: 0.2, prompt: "Ý có rõ, dễ theo không?" }
  - { id: accuracy, weight: 0.2, prompt: "Có khẳng định sai/thiếu căn cứ không?" }
  - { id: voice, weight: 0.2, prompt: "Có đúng giọng văn kênh không?" }
  - { id: pacing, weight: 0.2, prompt: "Nhịp có phù hợp đọc thành tiếng không?" }
severity_rules: "critical: sai sự thật/không dùng được; major: ảnh hưởng chất lượng rõ; minor: đánh bóng"
```
Điểm tổng = Σ điểm × weight. Hồ sơ kênh ghi đè rubric cùng `id` trong `profile/references/rubrics/`. Critic PHẢI trả JSON đúng `TextReviewOutput`; sai định dạng → thử lại 1 lần rồi `E_REVIEW_FORMAT`.

## 5. Frame packet (đầu vào phiên `frame`)

```ts
interface FramePacket {
  video_id: VideoId; frame: Frame; scene: Scene;
  lines: Line[]; timing: { start_ms: Ms; duration_ms: Ms };
  design_system: RelPath;                 // frame.md
  blueprint?: { id: string; path: RelPath; vars: Record<string, string> };
  assets: { asset_id: AssetId; file: RelPath; width: number; height: number; alpha: boolean }[];
  output_path: RelPath;                   // compositions/frames/<fr>.html — phạm vi ghi duy nhất
  rules: string[];                        // từ hồ sơ kênh: font, màu, vùng an toàn…
  pinned_delta?: ManualDelta;             // khi sinh lại có áp lại chỉnh tay
}
```
Agent PHẢI giữ `data-sf-id` cho mọi phần tử tương ứng `layers[].id`; phần tử phụ trợ tự đặt `data-sf-id` mới tiền tố `el_` và báo trong `workflow.step_complete`.

## 6. Hồ sơ kênh `profile/`

### 6.1 Bố cục (plugin)

```
profile/
  .claude-plugin/plugin.json        { "name": "channel-<slug>" }
  skills/channel/SKILL.md           giọng văn, phong cách, quy tắc nội dung, cách dùng references
  frame.md.tpl                      mẫu design system (sinh frame.md)
  references/
    style-guide.md                  giọng văn, từ nên/không nên, ví dụ đoạn hay
    rubrics/*.yaml                  ghi đè rubric
    blueprints/<id>/                sub-composition riêng của kênh (D13)
    prompts/                        gói prompt (mục 6.2)
    preferences.md                  sở thích của người dùng ghi nhận qua chat
```

`SKILL.md` KHÔNG chép giá trị máy đọc; tham chiếu bằng `{{config:<khóa>}}` (ví dụ `{{config:look.id}}`), được thay bằng `resolveConfig` (D3 mục 7.3) khi nạp.

### 6.2 Gói prompt `profile/references/prompts/`

```
prompts/
  pack.yaml
  common/voice.md  common/banned.md  common/tts-rules.md  common/examples.md
  script.md  outline.md  screenplay.md  title.md  description.md  revise.md
```

```yaml
# pack.yaml
schema_version: 1
steps:
  script:      { template: script.md,      include: [common/voice.md, common/banned.md, common/tts-rules.md, common/examples.md], token_cap: 6000 }
  outline:     { template: outline.md,     include: [common/voice.md], token_cap: 4000 }
  screenplay:  { template: screenplay.md,  include: [common/voice.md, common/banned.md, common/tts-rules.md], token_cap: 7000 }
  title:       { template: title.md,       include: [common/voice.md], token_cap: 1500 }
  description: { template: description.md, include: [common/voice.md, common/banned.md], token_cap: 2000 }
  revise:      { template: revise.md,      include: [common/voice.md, common/tts-rules.md], token_cap: 4000 }
summaries: { common/examples.md: common/examples.summary.md }   # dùng khi vượt token_cap
```
- Template dùng biến `{{brief}}`, `{{target_words}}`, `{{language}}`, `{{rubric_short}}`, `{{issues}}`, `{{draft}}`.
- Lắp prompt: template + include theo thứ tự; vượt `token_cap` → thay file có bản tóm tắt; vẫn vượt → `E_PROMPT_TOO_LONG`.
- Producer chỉ nhận `rubric_short` (tên tiêu chí + một câu); critic nhận rubric đầy đủ.

### 6.3 `channel.validate`
Kiểm và trả danh sách lỗi/cảnh báo:
- `channel.json` hợp lệ schema (D3 mục 6).
- Mọi `{{config:<khóa>}}` trong `profile/**/*.md` là khóa hợp lệ (D3 mục 7.2).
- File được tham chiếu tồn tại: voice, LUT, bộ miệng, blueprint, rubric, include của `pack.yaml`.
- `pack.yaml` hợp lệ; mỗi bước có template.
- Rubric hợp lệ; tổng weight = 1 (±0,01).
Chạy khi: agent ghi file trong `profile/` hoặc `channel.json`; mở kênh; trong hồi quy.

## 7. Skill

| Skill | Thuộc | Nhiệm vụ |
|---|---|---|
| `studioflow` (router) | `studioflow-core` | Pha briefing (mục 3.0): chốt brief theo hồ sơ kênh; chọn workflow qua `workflow.list`/`workflow.select`; ghi `BRIEF.md`; tiếp tục dự án theo `state.json` |
| `sf-voice`, `sf-assets`, `sf-look` | `studioflow-core` | Cách dùng capability giọng, asset, look; không nhắc tên model |
| skill HyperFrames đã fork (`hyperframes-core`, `-animation`, `-keyframes`, `-creative`, `-cli`, `-registry`, `-audio`, `media-use`) | `studioflow-core` | Kiến thức dựng; đã áp delta (mục 8) |
| `<workflow-id>` | gói workflow | Hướng dẫn theo bước |
| `channel` | hồ sơ kênh | Phong cách kênh |

## 8. Fork và delta từ HyperFrames

- Sao chép skill/workflow HyperFrames ở phiên bản ghim vào `extensions/…/upstream/` (chỉ đọc).
- Delta là file Markdown trong `delta/`, mỗi file mô tả một thay đổi: `target` (file + mục), `action` (`replace` | `insert_after` | `remove`), nội dung. Công cụ build (`sf ext build`) áp delta lên `upstream/` → sinh `skills/` cuối. Không sửa tay `skills/` sinh ra.
- Delta chung bắt buộc cho mọi workflow fork (kiến trúc mục 8.4): thay bước script; giọng qua `tts.synthesize`/`asr.align`; bỏ nhánh chọn TTS của `media-use`; nhạc qua `music.find`; thêm bước `assets`; `frame.md` từ hồ sơ kênh; giữ `data-sf-id`.
- Nâng phiên bản HyperFrames: cập nhật `upstream/` → `sf ext build` → báo delta không áp được → sửa delta → chạy hồi quy (D12).

## 9. Mã lỗi

| Mã | Khi |
|---|---|
| `E_STEP_INCOMPLETE` | Agent dừng mà không báo xong bước |
| `E_GATE_FAILED` | Gate không qua (kèm danh sách) |
| `E_REFINE_SAME_MODEL` | Producer và critic trùng model |
| `E_REVIEW_FORMAT` | Critic trả sai định dạng |
| `E_PROMPT_TOO_LONG` | Gói prompt vượt trần token sau khi tóm tắt |
| `E_WORKFLOW_INCOMPATIBLE` | `app_api` hoặc capability bắt buộc không thỏa |
| `E_DELTA_APPLY` | Delta không áp được lên upstream |
| `E_EXTENSION_INCOMPATIBLE` | Gói (provider, blueprint, style, output) không thỏa `app_api`/phiên bản phụ thuộc |
| `E_STEP_ORDER` | Manifest có bước đọc dữ liệu do bước sau ghi |
