# D4 — Spec capability, Gateway và hạ tầng chạy

**Phiên bản:** 1.2 · **Ngày:** 03/10/2026
**Dựa trên:** `00-architecture.md` mục 6, 7 · `03-spec-domain-artifacts.md`
**Phủ:** FR-VO-01..04, FR-IM-02..05, FR-OP-01..06, FR-RD-01/02, FR-CH-03, NFR-01/02/04/06/08
**Tính năng triển khai:** 003, 004, 006, 010, 011, 013, 014, 018, 019, 020, 024

---

## 1. Tiến trình

| Tiến trình | Nền | Vai trò |
|---|---|---|
| `main` | Electron | Cửa sổ, đăng nhập, kho bí mật, khởi động `core` |
| `renderer` | React | UI; nói chuyện với `core` qua IPC JSON-RPC (D10 mục 4) |
| `core` | Node | Gateway, Workflow Engine, Agent Runtime, job queue, build graph, cache, model manager |
| `worker-<engine>` | Python | Một tiến trình mỗi engine: `omnivoice` (GPU), `audio-analysis` (CPU), `clap` (CPU, từ M2) |
| `hf-cli` | Node | Lệnh HyperFrames ghim phiên bản (`lint`, `check`, `snapshot`, `transcribe`, `remove-background`…), chạy theo lệnh rồi thoát; ASR chạy ở đây (engine lịch GPU `asr`) |
| `comfyui` | Python | ComfyUI headless, cổng ngẫu nhiên trên 127.0.0.1 |
| `hf-studio` | Node | `hyperframes preview` (bản ghim) trên thư mục video hoặc bản làm việc (D9) |
| `hf-render` | Node | `@hyperframes/producer` chạy trong tiến trình con riêng cho mỗi render |

Bất biến: `core` là tiến trình duy nhất ghi vào project; mọi tiến trình con do `core` khởi động và dừng; khi `core` thoát, không còn tiến trình con mồ côi. Cơ chế cụ thể: tech-defaults.

## 2. Gateway

### 2.1 Giao tiếp
- Gateway là **một MCP server tên `sf`**, dùng được trong tiến trình (runtime chạy cùng `core`) và qua HTTP chỉ trên `127.0.0.1` có token sinh mỗi lần khởi động (runtime khác). Cách gắn cụ thể theo runtime: tech-defaults.
- **Tên tool:** tên logic dạng `nhóm.tên` (tài liệu, log); tên MCP thay `.` bằng `_` (ví dụ `artifact.write` → `artifact_write`; trong Agent SDK hiện là `mcp__sf__artifact_write`).

### 2.2 Ngữ cảnh phiên
Mỗi phiên agent gắn một `SessionContext` khi mở (D5):

```ts
interface SessionContext {
  session_id: SessionId; kind: 'main' | 'frame' | 'producer' | 'critic' | 'ops';
  channel_dir: string; video_id?: VideoId; frame_id?: FrameId;
  allowed_paths?: RelPath[];          // phạm vi ghi (frame/producer)
  read_only_videos?: VideoId[];       // đọc chéo video (shorts từ video dài)
}
```
Tool không nhận `channel_dir`/`video_id` từ agent; lấy từ ngữ cảnh. Ngoại lệ — phiên `ops` (055) không gắn với kênh nào (`channel_dir` = thư mục dữ liệu app): các tool vận hành nhận thêm tham số tùy chọn `channel` (đường dẫn hoặc tên kênh quản lý đang bật Autopilot), Gateway đổi thành kho ghi của kênh đó; kênh lạ → `E_ID_UNKNOWN`. Phiên `frame` chỉ ghi được các file trong `allowed_paths`. `artifact.read` chấp nhận tiền tố `video:<vd>/…` cho video trong `read_only_videos`.

### 2.3 Định dạng kết quả

```ts
type ToolResult<T> =
  | { ok: true; data: T; job_id?: string }          // job_id khi việc chạy nền
  | { ok: false; error: { code: string; message: string; details?: unknown; retryable: boolean } };
```
Thông báo lỗi bằng tiếng Việt, ngắn, nói rõ cách sửa. Việc dài (> 2 giây dự kiến) luôn trả `job_id` ngay; agent dùng `job.wait`/`job.status`.

**Hỏi người dùng giữa tool:** khi chính sách yêu cầu xác nhận (D5 mục 5.1), handler của tool **chờ** quyết định: phát sự kiện `permission.requested {request_id, session_id, tool, summary, estimate}` lên bus của `core` (UI nhận qua IPC), đợi `permission.decide`. Đồng ý → chạy tiếp và trả kết quả bình thường; từ chối hoặc hết 10 phút → `E_PERMISSION_DECLINED`. Agent không cần gọi lại.

### 2.4 Danh mục tool

| Tool | Đầu vào chính | Đầu ra | Ghi chú |
|---|---|---|---|
| `artifact.read` | `path` | `{content, hash, schema_version?}` | Chỉ trong kênh/video hiện tại |
| `artifact.write` | `path, content, base_hash?` | `{hash, assigned_ids?}` | Kiểm schema, owner, `base_hash`, phạm vi; gán ID cho line/beat mới (D3 5.4); sao lưu khi cần |
| `artifact.edit` | `path, edits: {old, new}[], base_hash?` | `{hash, assigned_ids?}` | 093: sửa đúng đoạn sai (mỗi `old` xuất hiện đúng một lần) thay vì viết lại cả file; cùng kiểm tra như `artifact.write` |
| `artifact.validate` | `path` hoặc `{path, content}` | `{valid, errors[]}` | |
| `artifact.list` | `glob` | `{paths[]}` | |
| `config.resolve` | `key, scene_id?, frame_id?` | `ResolvedValue` | D3 mục 7 |
| `config.set` | `key, value, tier: 'channel'\|'video'` | `{}` | Kiểm tầng cho phép (D3 mục 7.2) |
| `script.run` | `command, args[]` | job | Danh sách lệnh cho phép ở D5 |
| `graph.status` | `scope?` | `{nodes: NodeStatus[]}` | Mục 7 |
| `graph.plan` | `targets?` | `{jobs: PlannedJob[], estimate}` | Không chạy |
| `graph.build` | `targets?` | job | Chạy kế hoạch; vượt ngưỡng sinh hàng loạt → hỏi người dùng (mục 2.3) |
| `workflow.list` | — | `{workflows: {id, version, title, description, output_profiles}[]}` | Workflow đã cài và tương thích |
| `workflow.select` | `workflow_id, output_profile` | `{}` | Chỉ khi `phase = briefing`; ghi đề xuất vào `BRIEF.md` |
| `workflow.state` | — | `VideoStateSummary` (mục 3.1) | |
| `workflow.run_to` / `workflow.pause` / `workflow.rewind` | `step_id` / — / `step_id` | `{}` | Điều khiển engine theo lệnh chat (D6 mục 3.2) |
| `workflow.step_complete` | `step_id, frame_id?, outputs[], new_element_ids?` | `{next_step?}` | Agent báo xong bước agent-thực-hiện; bước `frame-build` xong khi mọi frame đã báo (D6); bước đang chờ người dùng trả lời (agent dừng lượt để hỏi, lỗi kết thúc `waiting for your reply in chat`) → nhận, bước chạy tiếp khi lượt chat kết thúc (083) |
| `workflow.gate_check` | `step_id` | `{pass, results[]}` | |
| `workflow.recheck` | `step_id` | `{pass, results[]}` | Bước lỗi đã được sửa file: kiểm gate lại trên file hiện có, không sinh lại; qua → điểm duyệt/xong, chạy tiếp (036) |
| `workflow.waive` | `step_id`, `check` | `{pass, results[]}` | Bước lỗi chỉ vì kiểm mềm (`audio_duration`, `E_GATE_WARNING`) và người dùng đồng ý giữ nguyên: ghi miễn trừ vào bước (`waived`) rồi kiểm lại như `workflow.recheck`; chạy lại bước thì miễn trừ mất (043) |
| `approval.annotate` | `step_id, summary` | `{}` | Agent gắn tóm tắt cho thẻ duyệt do engine tạo (D6 mục 3.1) |
| `studio.open` / `studio.commit` / `studio.close` | `mode: 'preview'\|'edit'` / `message?` / — | D9 | |
| `job.status` / `job.wait` / `job.cancel` / `job.list` | `job_id`, `timeout_ms` | `JobInfo` | |
| `video.create` | `title, instruction` | `{video_id, note}` | Chỉ ở chat kênh (chưa ở video nào; trong video → `E_SCHEMA_INVALID`): tạo video, app mở video đó và chuyển `instruction` sang phiên chat của video khi lượt kênh xong (081) |
| `asset.import` | `path` (trong `uploads/`), `tags, description` | `{asset_id}` | Đưa file đính kèm vào thư viện kênh + `public/` |
| `asset.search` | `query, tags?` | `{assets[]}` | Thư viện kênh |
| `music.library.add` | D8 | D8 | |
| `music.find` / `sfx.find` | D8 | D8 | |
| `youtube.video` | `url` (URL hoặc ID 11 ký tự) | `{video_id, url, title, channel{id,title}, published_at, duration_s, stats{views,likes,comments}, tags, description}` | Video YouTube tham khảo (044, mục 9.4) |
| `youtube.transcript` | `url, language?` | `{video_id, language, segments, text, truncated?}` — `text` gộp mốc ~20 giây `[m:ss] …` | Thử ngôn ngữ yêu cầu → vi → en → ngôn ngữ có sẵn; không có → `E_FILE_NOT_FOUND` |
| `youtube.search` | `query, max_results?, order?, published_after?` | `{videos[]: {video_id, url, title, channel, published_at}}` | Nghiên cứu chủ đề / video hot |
| `youtube.channel_videos` | `channel_id, max_results?` | như `youtube.search` | Video mới nhất của kênh (đối thủ) |
| `research.scan` | — | job → `{path, date, quota_units, candidates, errors[]}` | Quét nghiên cứu của kênh hôm nay (049, mục 9.5) → ghi `research/<YYYY-MM-DD>.json` (D3 5.17); quét lại trong ngày ghi đè; nguồn lỗi ghi vào `sources`, không làm job lỗi |
| `research.get` | `date?` (`YYYY-MM-DD`) | `ResearchDoc` (D3 5.17) | Kết quả quét của ngày (mặc định ngày gần nhất); chưa có → `E_FILE_NOT_FOUND` |
| `autopilot.plan_get` | `date?` (`YYYY-MM-DD`) | `DailyPlan` (D3 5.18) | Kế hoạch ngày Autopilot của kênh (051; mặc định hôm nay theo `publish.timezone`); chưa có → `E_FILE_NOT_FOUND` |
| `autopilot.plan_run` | — | job → `{date, path, planned, kept, notes[]}` | Lập/lập lại kế hoạch hôm nay cho kênh (051): dùng file quét nghiên cứu hôm nay nếu có, chưa có thì quét; chuyển mục `planned` chưa làm của hôm qua sang trước, bỏ ứng viên dưới `autopilot.min_score`, giữ mọi mục đã có, chỉ lấp chỗ trống; `autopilot.paused` → không làm gì |
| `autopilot.plan_update` | `date, item_id, patch: {status?: skipped / planned, title?, angle?, workflow_id?, publish_at?}` | `PlanItem` | Sửa một mục kế hoạch (051): workflow phải thuộc danh sách cho phép, `publish_at` là ISO 8601 có offset (hoặc null), không sửa mục `in_production` / `produced` / `failed` (`E_SCHEMA_INVALID`) |
| `autopilot.status` | — | `{paused, running, waiting_until?, current?, today: {date, items[]}, log[]}` | Tình hình Autopilot của kênh (052): đang tạm dừng/đang chạy, mục kế hoạch hôm nay và trạng thái (`planned` / `in_production` / `produced` / `failed` / `needs_review`), video đang làm ở bước nào, thời điểm chờ nếu hết hạn mức Claude, và 20 dòng nhật ký vận hành gần nhất (D3 5.19). Chỉ đọc |
| `autopilot.pause`, `autopilot.resume` | — | `{paused}` | Tạm dừng / tiếp tục Autopilot (`autopilot.paused`, app; 055) |
| `ops.channels` | — | `{channels[{path, name, paused, items{planned, in_production, produced, needs_review, failed}}]}` | Kênh quản lý đang bật Autopilot và số mục kế hoạch hôm nay theo trạng thái (055, phiên `ops`) |
| `ops.log` | `channel?`, `date?`, `limit?` | `{lines[AutopilotLogLine]}` | Nhật ký vận hành Autopilot của kênh (D3 5.19); mặc định hôm nay, tối đa 100 dòng cuối (055) |
| `ops.sessions` | `limit?`, `id?` | `{sessions[…]}` hoặc `{lines[…]}` | Nhật ký các phiên `ops` (không có `id` → danh sách; có `id` → dòng của phiên); chỉ đọc (055) |
| `learning.get` | `channel?` (ops) | `ChannelLearning` (D3 5.21) hoặc `{enough_data: false, …}` | Điều chỉnh điểm chủ đề đã học của kênh: nhóm nào hiệu quả hơn/kém trung bình, hệ số, số mẫu (057) |
| `report.get` | `date?`, `channel?` (ops) | `DailyReport` (D3 5.20) | Báo cáo ngày của kênh: nếu đã có file của ngày thì trả file, chưa có thì tính ngay từ số liệu hiện có (không gửi, không ghi) (054) |
| `publish.status` | `date?`, `channel?` (ops) | `{date, items[{id, title, status, publish}]}` | Trạng thái đăng của các mục kế hoạch đã làm xong trong ngày (053, D3 5.18) |
| `publish.cancel` | `item_id`, `date?`, `platform?` (`youtube`), `channel?` (ops) | `{status}` | Hủy đăng trong cửa sổ phản đối: video ở lại riêng tư, bỏ hẹn giờ (053) |
| `publish.now` | `item_id`, `date?`, `platform?`, `channel?` (ops) | `{status, url?, note?}` | Đăng ngay: chuyển video sang công khai; khi `publish.youtube.audited` = false thì không làm được và trả hướng dẫn công khai thủ công (053) |
| `voice.profile_create` | `name, ref_audio (upload), language` | `{voice_id}` + job | |
| `voice.design` | `name, gender, age, pitch, whisper?, accent? (chỉ en), for?, sample_text?, seed?` | job → `{voice_id, name, for?, preview, design}` | Giọng gợi ý từ mô tả khi chưa có file mẫu (033): sinh câu mẫu theo mô tả rồi clone → `voices/<vo>/` như `voice.profile_create` |
| `voice.preview` | `voice_id, text, emotion?` | job → `{file}` | Nghe thử |
| `voice.list` | — | `{narrator_voice_id, voices[{voice_id, name, language, kind, ready, design?, suggested_for?, used_by[], created_at}]}` | Giọng có sẵn của kênh để dùng lại (035); chỉ đọc |
| `cast.list` | — | `{characters[{id, name, voice_id?, voice_name?, caption_color?, reference_images, expressions[]}]}` | Nhân vật cấp kênh `characters/*/cast.json` để dùng lại (035); chỉ đọc |
| `tts.synthesize` | `line_ids[]` hoặc `"all"` | job | Ghi `audio/lines/*`, cập nhật `audio_meta.json` |
| `asr.align` | `line_ids[]` hoặc `"all"` | job | Cập nhật `words`, `asr_wer`, `asr_flag`; line `mismatch` tự sinh lại tối đa `asr.max_regen` lần |
| `asr.accept` | `line_ids[]` | `{}` | Người dùng chấp nhận line lệch → `asr_flag = accepted` |
| `image.generate` | `ImageGenerateInput` | job → `{asset_id}` | |
| `image.edit` | `ImageEditInput` | job → `{asset_id}` | |
| `image.remove_bg` | `asset_id, subject: 'person'\|'object'` | job → `{asset_id}` | |
| `lipsync.cues` | `line_ids[]` | job | |
| `grade.compare` | `asset_ids[], looks[]` | job → `{contact_sheet}` | |
| `media.treatment` | `asset_id, effect, mode: 'dry_run'|'apply'` | job | |
| `render.video` | `mode: 'draft'|'release'` | job → `RenderRecord` | Chạy gate trước nếu `release` |

Capability `text.generate`/`text.review` **không** mở cho agent; chỉ Workflow Engine gọi (D6). Ghi vòng `refine-loop` là API nội bộ của engine, không phải tool.

Upload không phải tool: UI gọi IPC `upload.ingest` (D10) để chép file đính kèm vào `uploads/<uuid>.<ext>`; agent nhận đường dẫn đó và dùng `asset.import` / `music.library.add` / `voice.profile_create`.

## 3. Hợp đồng capability

```ts
interface CapabilityContract<I, O> { id: string; version: string; input: I; output: O; resource: ResourceClass; cacheable: boolean; }
type ResourceClass = 'gpu-heavy' | 'gpu-light' | 'cpu' | 'network';

// voice.profile
interface VoiceProfileInput { name: string; language: Lang; ref_audio: RelPath; emotions?: Record<string, RelPath>; }
interface VoiceProfileOutput { voice_id: VoiceId; files: RelPath[]; }

// voice.design (033): instruct theo từ vựng OmniVoice, ví dụ "female, young adult, moderate pitch"
interface VoiceDesignInput { name: string; language: Lang; instruct: string; sample_text: string; seed?: number; }
// đầu ra như VoiceProfileOutput; profile.json thêm design: { instruct, seed }, suggested_for?

// tts.synthesize (một line mỗi lần gọi provider)
interface TtsInput { text: string; language: Lang; voice_id: VoiceId; emotion?: string; speed?: number; }
interface TtsOutput { file: RelPath; duration_ms: Ms; sample_rate: 48000; }

// asr.align
interface AsrAlignInput { audio: RelPath; language: Lang; expected_text: string; }
interface AsrAlignOutput { words: { i: number; text: string; start_ms: Ms; end_ms: Ms; conf?: number }[]; transcript: string; wer: number; }

// image.generate / image.edit
interface ImageGenerateInput { prompt: string; negative_prompt?: string; width: number; height: number; transparent?: boolean;
  reference_asset_ids?: AssetId[]; look?: string; seed?: number; steps?: number; }
interface ImageEditInput { source_asset_id: AssetId; instruction: string; mask_asset_id?: AssetId; reference_asset_ids?: AssetId[]; seed?: number; }
interface ImageOutput { file: RelPath; width: number; height: number; alpha: boolean; seed: number; }

// image.remove_bg
interface RemoveBgInput { source_asset_id: AssetId; subject: 'person' | 'object'; }

// text.generate / text.review (chỉ Workflow Engine)
interface TextGenerateInput { role: 'primary' | 'aux'; messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  max_tokens: number; temperature?: number; response_format?: 'text' | 'json'; }
interface TextGenerateOutput { text: string; usage: { input: number; output: number }; cost_usd: number; model: string; }
interface TextReviewInput { artifact_text: string; rubric: Rubric; brief: string; prior_issues?: ReviewRound['issues']; }
interface TextReviewOutput { score: number; criteria: ReviewRound['criteria']; issues: ReviewRound['issues']; usage: TextGenerateOutput['usage']; cost_usd: number; model: string; }

// lipsync.cues
interface LipsyncInput { audio: RelPath; fps: number; thresholds?: { half: number; open: number }; }

// render.video
interface RenderInput { mode: 'draft' | 'release'; output_profile: string; }
```

`max_tokens` (2026-10-10) chỉ còn là gợi ý, provider không dùng làm trần: Claude chạy với `CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000`, DeepSeek xin tối đa 8192, OpenAI không gửi trần. Trả lời bị cắt vì hết độ dài (`finish_reason: length`, Claude báo vượt trần) → `E_PROVIDER_FAILED`, không nhận văn bản dở. Chi phí kiểm bằng `budget.tokens_per_video` / `budget.api_cost_usd_per_video`.
`Rubric` định nghĩa ở D6 mục 4.3. `music.*` ở D8.

### 3.1 Kiểu phụ

```ts
interface VideoStateSummary { video_id: VideoId; phase: VideoState['phase']; workflow: VideoState['workflow'];
  current_step?: string; steps: { id: string; title: string; status: StepState['status']; refine?: StepState['refine']; uses?: string }[];  // uses (092): loại bước trong thư viện D6
  pending_approvals: ApprovalId[]; owner: VideoState['owner']; budget: VideoState['budget']; }
interface NodeStatus { key: string; type: string; status: 'fresh' | 'stale' | 'missing' | 'pinned' | 'pinned_stale' | 'failed' | 'external_change' | 'orphan';
  reason?: string; decision_required?: boolean; }
interface PlannedJob { kind: string; targets: string[]; engine?: string; phase: number; est_ms: number; est_cost_usd: number; from_cache: boolean; }
interface PlanEstimate { total_ms: number; total_cost_usd: number; jobs_count: number; cached_count: number; }
// graph.plan trả { jobs: PlannedJob[]; estimate: PlanEstimate }
```

## 4. Provider

### 4.1 Manifest `extensions/providers/<id>/provider.yaml`

```ts
interface ProviderManifest {
  id: string; version: string; capabilities: string[]; contract_versions: Record<string, string>;
  runtime: 'python-worker' | 'comfyui' | 'node' | 'cloud' | 'agent-runtime';
  engine?: string; resource: ResourceClass; languages?: Lang[]; models?: string[];
  install_profile: 'minimal' | 'standard' | 'full'; cost: { kind: 'free' | 'per_token' | 'per_image' | 'per_second' };
  limits?: Record<string, number>; health: { method: string; timeout_ms: number };
  secrets?: string[]; network?: string[]; app_api: string;
  defaults?: Record<string, unknown>;              // tham số mặc định của model (mục 9.2)
}
```

```yaml
id: tts.omnivoice
version: 1.0.0
capabilities: [voice.profile, voice.design, tts.synthesize]
contract_versions: { tts.synthesize: "1", voice.profile: "1", voice.design: "1" }
runtime: python-worker          # python-worker | comfyui | node | cloud | agent-runtime
engine: omnivoice               # khóa lịch GPU
resource: gpu-light
languages: [vi, de, en]
models: [omnivoice-base]        # khóa trong models.yaml (mục 10)
install_profile: standard       # minimal | standard | full
cost: { kind: free }            # free | per_token | per_image | per_second
limits: { max_chars: 600 }
health: { method: health, timeout_ms: 5000 }
app_api: ">=1.0 <2.0"
```

### 4.2 Giao diện adapter (TypeScript, `packages/core`)

```ts
interface ProviderAdapter<I, O> {
  manifest: ProviderManifest;
  health(): Promise<{ ok: boolean; detail?: string }>;
  prepare?(): Promise<void>;                       // nạp model / khởi động engine
  run(input: I, ctx: RunContext): Promise<O>;
  release?(mode: 'offload' | 'unload'): Promise<void>;
  cacheKeyParts(input: I): unknown;                // phần đầu vào quyết định kết quả
}

interface RunContext {
  signal: AbortSignal; workdir: string;            // thư mục tạm riêng cho lần chạy
  progress(done: number, total: number, message?: string): void;
  logger: Logger; span: Span;                      // OpenTelemetry
  resolveInput(path: RelPath): string;             // đường dẫn tuyệt đối để đọc
  secrets: (name: string) => Promise<string>;      // chỉ provider khai báo secrets
}
```

### 4.3 Provider mặc định

| Capability | Provider id | Runtime | GĐ |
|---|---|---|---|
| `voice.profile`, `tts.synthesize` | `tts.omnivoice` (engine `omnivoice`) | python-worker | M0 |
| `voice.design` | `tts.omnivoice` (Voice Design của OmniVoice) | python-worker | 033 |
| (dự phòng vi) | `tts.vbee` | cloud | khi S1 không đạt |
| `asr.align` | `asr.hf-transcribe` (gọi `hyperframes transcribe` bản ghim; engine `asr`) | node | M1 |
| `image.generate`, `image.edit` | `image.qwen21-comfy` | comfyui | M2 |
| (tùy chọn) | `image.qwen20-api` | cloud | M2 `[chờ S2c]` |
| (test, CI) | `tts.fake`, `image.fake`, `asr.fake` | node | M0 — chỉ khi `SF_GPU=0` (D12) |
| (quan sát) | `obs.phoenix` (không phải capability; gói cài Phoenix) | python | M3 |
| `image.remove_bg` | `bg.hf-remove-background` | node | M2 |
| `music.analyze`, `music.embed` (nội bộ, dùng bởi `music.library.add`/`music.find`) | `audio.analysis` (engine `audio-analysis`), `audio.clap` (engine `clap`) | python-worker | M1, M2 |
| `text.generate` | `text.openai`, `text.deepseek` (cloud), `text.claude` (agent-runtime) | cloud / agent-runtime | M1 |
| `text.review` | `text.claude` (phiên critic qua Agent Runtime), `text.openai`, `text.deepseek` | — | M1 |
| `lipsync.cues` | `lipsync.amplitude` | node | M5b |
| `grade.compare`, `media.treatment` | `hf.cli` | node | M3 |

Mặc định `text.*` (085, khi khóa chưa đặt ở tầng nào): `advanced.reasoning` tắt → `text.producer` = `deepseek/deepseek-chat` nếu có khóa DeepSeek, không thì `claude/claude-sonnet-5-5`; `text.critic` = `claude/claude-sonnet-5-5` (producer là Sonnet → `claude/claude-haiku-4-5`); `advanced.reasoning` bật → producer `claude/claude-opus-5-5`, critic `claude/claude-sonnet-5-5`. `text.aux` = `deepseek/deepseek-chat` nếu có khóa, không thì `claude/claude-haiku-4-5`.
| `render.video` | `render.hf-producer` | node | M1 |

Render một lần (2026-10-10): bản HyperFrames của render nháp được giữ ở `videos/<vd>/.sf/render-raw/<khóa>.mp4` (khóa = nội dung `index.html`, `hyperframes.json`, `compositions/`, `audio/`, `public/` + fps/crf + bản HyperFrames; chỉ giữ bản mới nhất). Render phát hành cùng khóa dùng lại bản đó, chỉ hoàn thiện (chuẩn hóa âm lượng, mã lại theo chuẩn đăng). `hyperframes check` (trình duyệt) chỉ chạy khi video có frame do AI vẽ.

### 4.4 Định tuyến
Chọn provider theo: khóa `provider.<capability>` (D3 mục 7) → provider khả dụng (cài rồi + `health` ok) → hỗ trợ ngôn ngữ → chuỗi dự phòng trong `settings.json`. Không có provider khả dụng → `E_PROVIDER_UNAVAILABLE` kèm gợi ý cài hồ sơ.

## 5. Job

```ts
interface JobInfo {
  id: string; kind: string;               // capability id hoặc 'graph.build' | 'render' | 'script' | 'download'
  video_id?: VideoId; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'partial';
  progress: { done: number; total: number; message?: string };
  engine?: string; priority: 0 | 1 | 2;   // 2 = đang chặn điểm duyệt
  attempts: number; max_attempts: number; // mặc định 3 (1 lần chạy + 2 lần thử lại)
  created_at: Iso8601; started_at?: Iso8601; finished_at?: Iso8601;
  result?: unknown; error?: { code: string; message: string; retryable: boolean };
  children?: string[];                    // job con (ví dụ một job/line)
}
```
- Lưu trong bảng `jobs` của `studioflow.db`; ghi trạng thái mỗi lần đổi.
- **Khôi phục (NFR-02):** khi `core` khởi động, job `running` → `queued` (attempt giữ nguyên) nếu idempotent, ngược lại → `failed` với `E_JOB_INTERRUPTED`.
- **Thử lại:** chỉ lỗi `retryable`, có backoff (giá trị: tech-defaults).
- **Hủy:** gửi abort tới adapter; adapter phải dừng trong ≤ 5 s; job con chưa chạy bị hủy.
- **Kết quả từng phần:** job cha `partial` khi một số job con lỗi; kết quả các job con thành công vẫn được ghi.
- Sự kiện `job.updated` đẩy qua IPC tới UI (D10).

## 6. Lịch GPU

- **Engine:** `omnivoice`, `asr`, `comfyui`, `audio-analysis` (CPU), `clap` (CPU), `render`.
- **Quy tắc:**
  1. Tối đa một job `gpu-heavy` chạy cùng lúc; `gpu-light` chạy cùng nhau nếu tổng ngân sách VRAM ≤ `gpu.vram_total_gb`.
  2. Trước khi chạy job của engine E: engine khác đang giữ VRAM mà không vừa → gọi `release('offload')` (worker Python chuyển model sang RAM; ComfyUI `POST /free {"unload_models": true, "free_memory": true}`).
  3. Hàng đợi chọn job theo: ưu tiên (2 > 1 > 0) → **cùng engine đang nóng** → thứ tự tạo.
  4. `graph.build` sinh job theo pha: tất cả `tts` → `asr` → `image` → `lipsync` → lắp/`render`.
  5. Thay đổi lẻ (từ chat) được gom trong một cửa sổ ngắn trước khi xếp hàng (giá trị: tech-defaults).
- **Ngân sách VRAM** theo engine: khóa `gpu.vram_budget_gb.<engine>` (D3 mục 7.2); `comfyui` luôn độc chiếm GPU.

## 7. Cache

- **Khóa:** `sha256(canonical_json({capability, contract_version, provider_id, provider_version, model_file_hash, input: adapter.cacheKeyParts(input), seed}))`. File đầu vào được thay bằng hash nội dung.
- **Lưu:** `<channel>/cache/objects/<2 ký tự đầu>/<key>/` (file kết quả + `meta.json`); chỉ mục trong bảng `cache_entries` của `studioflow.db` (key, channel, size, last_used).
- **Dùng:** trước khi chạy adapter, tra khóa; trúng → chép (hard link nếu cùng ổ) vào đích, ghi provenance `from_cache: true`.
- **Dọn:** không vượt `budget.cache_gb` của kênh; xóa mục ít dùng nhất trước; mục còn được artifact hiện tại tham chiếu thì sinh lại được nên được phép xóa (chính sách chi tiết: FN-024).
- Không cache: `text.*` (trừ khi `temperature = 0`), `render.video`.

## 8. Build graph

### 8.1 Nút

| Loại nút | Khóa | Đầu vào | Đầu ra |
|---|---|---|---|
| `audio.line` | `ln_*` | line (text, tts_text, emotion, speaker), voice files, provider | `audio/lines/<ln>.wav` |
| `asr.line` | `ln_*` | `audio.line`, text | words trong `audio_meta.json` |
| `audio_meta` | — | mọi `audio.line`, `asr.line`, `pause_after_ms`, thứ tự line | `audio_meta.json` (mốc trên chuỗi lời đọc) |
| `captions` | — | `audio_meta`, SCRIPT text, `caption.*` config | `caption_groups.json` |
| `frame_timing` | — (toàn video) | `audio_meta`, thứ tự frame, `line_ids`, `min_duration_ms`, transition | `start_ms`/`duration_ms` tuyệt đối mỗi frame và mỗi line (trong `graph.json`) |
| `asset` | `as_*`/`el_*` | `asset_request`, look, provider | file trong `public/` + manifest |
| `lipsync.line` | `ln_*` | `audio.line` | `lipsync/<ln>.json` |
| `frame_html` | `fr_*` | `sf-frame` khối, asset, `frame.md`, blueprint, lipsync, frame_timing | `compositions/frames/<fr>.html` |
| `index` | — | mọi `frame_html`, `frame_timing`, captions, overrides, nhạc | `index.html` |
| `credits` | — | nhạc/asset đã dùng | `CREDITS.txt` (trong render) |
| `render` | `rd_*` | `index`, output profile | MP4 |

### 8.2 Trạng thái
`fresh` (hash đầu vào khớp lần sinh) · `stale` (đầu vào đổi) · `missing` · `pinned` (frame đã chỉnh tay, đầu vào chưa đổi) · `pinned_stale` (đã chỉnh tay và đầu vào đổi) · `failed`. Lưu `<video>/.sf/graph.json`: mỗi nút `{key, input_hash, output_hash, status, updated_at}`.

### 8.3 Lan truyền và kế hoạch
- `input_hash` = hash các phần đầu vào liệt kê ở 8.1; đổi → nút `stale`, lan theo cạnh.
- **Mô hình thời gian:** `frame_timing` đặt frame nối tiếp theo thứ tự; thời lượng frame = tổng `duration_ms + pause_after_ms` của các line của nó, hoặc `frame.min_duration_ms` nếu không có line (lấy giá trị lớn hơn nếu frame có `min_duration_ms`). Transition **chồng** lên cuối frame trước (không làm dài video). Mốc tuyệt đối của mỗi line = đầu frame chứa nó + vị trí trong frame. Mỗi line thuộc đúng một frame (gate D6).
- Đổi `text` của một line: `audio.line(ln)` → `asr.line(ln)` → `audio_meta` → `captions`, `frame_timing` → `frame_html(fr)` chỉ của frame có thời lượng đổi vượt 1 video frame → `index`.
- `graph.plan` trả danh sách job theo pha (mục 6), ước tính thời gian (từ lịch sử) và chi phí API.
- Nút `pinned_stale`: không lập job; `graph.status` trả `decision_required` (D9 mục 5).

## 9. Adapter ngoài

### 9.1 HyperFrames adapter
- Ghim phiên bản HyperFrames trong `extensions/providers/hf.cli/version.json`; cài vào `<app-data>/providers/hyperframes/`; mọi lệnh gọi bằng `node <đường dẫn cài>/hyperframes <lệnh>` (trong tài liệu viết tắt `hyperframes <lệnh>`), không dùng `npx` tải mạng lúc chạy.
- Tạo/cập nhật `hyperframes.json` của video.
- Chuyển định dạng: `SCRIPT.md`/`STORYBOARD.md`/`audio_meta.json` ↔ định dạng script HyperFrames cần; bản tạm ở `.sf/tmp/hf/` kèm `id-map.json` (tên file `NN-…` ↔ ID) `[chờ S3]`.
- Kiểm `data-sf-id` còn nguyên sau mọi lệnh HyperFrames ghi HTML; mất → `E_HF_ID_LOST`.
- GSAP nạp từ bản cục bộ `public/vendor/gsap-<ver>.min.js` của project (gói npm `gsap` ghim), không từ CDN; URL CDN trong frame/overlay được đổi sang bản cục bộ (059).

### 9.2 ComfyUI provider
- Bộ ghim cùng nhau: phiên bản ComfyUI, custom node, file model (từ kho model chung), workflow JSON. App quản lý vòng đời (khởi động, kiểm tra sức khỏe, khởi động lại), chỉ lắng nghe `127.0.0.1`.
- **Hợp đồng workflow JSON** (giữa gói provider và adapter): mỗi chế độ một file `workflows/<mode>.json` với `mode ∈ t2i | t2i_rgba | edit_ref | edit_mask`, chỗ thay thế `{{prompt}}`, `{{negative}}`, `{{width}}`, `{{height}}`, `{{seed}}`, `{{steps}}`, `{{image_in}}`, `{{mask_in}}`. Tham số mặc định của model nằm trong `provider.yaml` (`defaults`) của gói provider (giá trị hiện tại: FN-018).
- Adapter phải hỗ trợ: tiến độ, hủy, giải phóng VRAM theo lệnh của lịch GPU. Endpoint và cờ khởi động cụ thể: FN-018 `[chờ S2]`.

### 9.4 MCP server YouTube (044)
- Gói `zubeid-youtube-mcp-server` (MIT) ghim phiên bản trong `packages/core/src/youtube/mcp.ts`; cài lần đầu dùng vào `<app-data>/mcp/youtube/` bằng `npm install` (riêng app, không dùng chung); chạy `node <cài>/dist/cli.js` qua stdio, cwd = thư mục cài.
- Core là MCP client; tool của server được bọc thành tool Gateway `youtube.*` (mục 2.4) — kết quả rút gọn cho agent, lỗi chuẩn hoá (`E_PROVIDER_UNAVAILABLE` khi thiếu khóa, `E_PROVIDER_FAILED` khi server lỗi). Mở rộng (trending, kênh đối thủ, playlist) = bọc thêm tool của server.
- Khóa YouTube Data API v3: bí mật `youtube_api_key` (D5 mục 5.4), truyền vào server qua biến môi trường `YOUTUBE_API_KEY`.

### 9.5 Quét nghiên cứu Autopilot (049)
- Gọi thẳng REST (không qua MCP server mục 9.4) để tiết kiệm quota, cùng khóa `youtube_api_key`: `channels.list part=contentDetails` → playlist uploads (1 đơn vị); `playlistItems.list` (1 đơn vị/trang 50 video); `videos.list part=snippet,statistics,contentDetails` theo lô ≤ 50 ID (1 đơn vị); trending `videos.list chart=mostPopular regionCode` theo ngôn ngữ kênh (`vi`→VN, `de`→DE, `en`→US; 1 đơn vị). Không dùng `search.list` (100 đơn vị). Số đơn vị đã dùng ghi vào `quota_units`.
- Không cần khóa: Google Trends RSS `https://trends.google.com/trending/rss?geo=<VN|DE|US>`; Google News RSS `https://news.google.com/rss/search?q=<chủ đề>&hl=<lang>&gl=<geo>&ceid=<geo>:<lang>` cho mỗi chủ đề trụ cột.
- Mỗi nguồn độc lập: thiếu khóa → `E_PROVIDER_UNAVAILABLE`, HTTP lỗi → `E_PROVIDER_FAILED`, kênh đối thủ không có → `E_FILE_NOT_FOUND`, ghi vào `sources.*.error` của file kết quả; lần quét vẫn thành công.
- Tín hiệu và hằng số chấm điểm: FN-049.

### 9.6 Đăng YouTube (053)
- **OAuth theo kênh** (ứng dụng cài đặt, loopback + PKCE): máy chủ HTTP tạm trên `127.0.0.1:<cổng ngẫu nhiên>`, `state` ngẫu nhiên, `code_challenge` S256; đổi `code` ở `https://oauth2.googleapis.com/token` (client id/secret = bí mật `youtube_oauth_client_id` / `youtube_oauth_client_secret`). Phạm vi: `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly`, `youtube.force-ssl` (phụ đề). Refresh token lưu bí mật `oauth:youtube:<channel_id>` (`<channel_id>` = ID kênh StudioFlow `ch_…`) qua `SecretStore`; access token chỉ giữ trong bộ nhớ, tự làm mới trước hạn 60 s. Chờ người dùng tối đa 5 phút. Ngắt kết nối: thu hồi token (`/revoke`) rồi xóa bí mật.
- **Tải lên có thể tiếp tục:** `POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` (+ `X-Upload-Content-Type`, `X-Upload-Content-Length`) lấy URI phiên; `PUT` từng khúc 8 MiB (bội của 256 KiB) với `Content-Range`; `308` → gửi tiếp; lỗi mạng/5xx → hỏi vị trí đã nhận (`Content-Range: bytes */<tổng>`) rồi gửi tiếp từ đó (tối đa 5 lần mỗi khúc); URI phiên lưu để tiếp tục sau khi tắt app. `snippet`: `title` (≤ 100), `description` (≤ 5000 byte; mô tả của `renders/<rd>/description.txt` + chương nếu chưa có), `tags` (tổng ≤ 500 ký tự), `defaultLanguage`/`defaultAudioLanguage` = ngôn ngữ kênh, `categoryId` cố định 22 (People & Blogs); `status`: `privacyStatus: private`, `publishAt` (ISO UTC, chỉ khi `publish.youtube.audited` = true), `selfDeclaredMadeForKids: false`, `containsSyntheticMedia: true` (khai báo nội dung do AI tạo). Phụ đề: `captions.insert` (SRT dựng từ `caption_groups.json`, `isDraft: false`) nếu có. Hình đại diện: `thumbnails.set` nếu video có `thumbnail.jpg|png` (hiện chưa workflow nào sinh).
- **Quota** (đơn vị/lời gọi, mặc định 10 000 mỗi ngày Thái Bình Dương): `videos.insert` 1600, `captions.insert` 400, `videos.update` 50, `thumbnails.set` 50, `channels.list`/`videos.list` 1. Sổ đếm ở `<app-data>/youtube/quota.json`, nuôi mô hình năng lực (050 `youtube_units_used_today`). Google tính quota cả khi lỗi → đếm trước khi gọi.
- Lỗi chuẩn hoá: chưa kết nối / thiếu client id → `E_PROVIDER_UNAVAILABLE`; Google trả lỗi → `E_PROVIDER_FAILED` (`quotaExceeded` → kèm gợi ý đợi tới ngày sau); người dùng đóng trang cấp quyền → `E_PERMISSION_DECLINED`.

### 9.8 Đăng TikTok và Facebook Reels (056)
- Token do người dùng dán vào Cài đặt kênh (IPC `publish.<nền tảng>.set_token`), lưu bí mật `oauth:tiktok:<channel_id>` / `oauth:facebook:<channel_id>` qua `SecretStore`, không bao giờ vào file/log. OAuth đầy đủ để sau.
- **TikTok Content Posting API** (`https://open.tiktokapis.com/v2`, `Authorization: Bearer`): `POST /post/publish/video/init/` với `post_info{title ≤ 150, privacy_level, disable_duet/comment/stitch}` + `source_info{source: FILE_UPLOAD, video_size, chunk_size, total_chunk_count}` → `publish_id`, `upload_url`; `PUT upload_url` từng khúc (5–64 MiB, khúc cuối tới 128 MiB) với `Content-Range`, `Content-Type: video/mp4`; hỏi `POST /post/publish/status/fetch/ {publish_id}` đến `PUBLISH_COMPLETE` (hoặc `SEND_TO_USER_INBOX`) / `FAILED{fail_reason}`. `privacy_level` = `SELF_ONLY` trừ khi `publish.tiktok.audited` = true và đã tới giờ công khai (`PUBLIC_TO_EVERYONE`). Lỗi `access_token_invalid` → `E_PERMISSION_DECLINED` kèm hướng dẫn dán lại token.
- **Facebook Page Reels** (Graph API `https://graph.facebook.com/v21.0`): `POST /{page_id}/video_reels {upload_phase: start}` → `video_id`, `upload_url`; `POST upload_url` (`Authorization: OAuth <token>`, `offset: 0`, `file_size`) gửi nguyên tệp; `POST /{page_id}/video_reels {upload_phase: finish, video_id, video_state: SCHEDULED, scheduled_publish_time, description}` (hẹn giờ ≥ 10 phút sau). Hủy → `DELETE /{video_id}`; đăng ngay → `POST /{video_id} {published: true}`; làm mới → `GET /{video_id}?fields=published,status`. Token là access token Trang dài hạn (`pages_manage_posts`, `pages_read_engagement`).
- Cùng khung `PlatformPublisher` của 053: hàng đợi, thử lại tối đa 3 lần, nhật ký `publish.*`, tin xem trước Telegram với nút Hủy đăng / Đăng ngay.

### 9.7 Số liệu YouTube (054)
- Dùng token OAuth của kênh (9.6, phạm vi `yt-analytics.readonly`, `youtube.readonly`). **YouTube Analytics API** `GET https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&startDate&endDate&dimensions=day&metrics=views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes&sort=day` cho kênh; mỗi video do app đăng: thêm `filters=video==<id>` và `metrics=views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained`. Cửa sổ 7 ngày gần nhất mỗi lần (dữ liệu YouTube trễ và được chỉnh lại). **Data API** `videos.list part=statistics` theo lô ≤ 50 (1 đơn vị) cho ảnh chụp lũy kế.
- Thu tối đa mỗi 6 giờ mỗi kênh (cũng được thu trước khi soạn báo cáo nếu dữ liệu cũ hơn 6 giờ). Kênh chưa kết nối OAuth → bỏ qua, báo cáo ghi chú. Lỗi một nguồn không làm hỏng báo cáo.
- Chưa làm: impressions / CTR (YouTube Reporting API, báo cáo hàng loạt).

### 9.3 Worker Python
- Mỗi engine một tiến trình, giao tiếp **JSON-RPC 2.0 qua stdio** (một JSON mỗi dòng). Log ra stderr.
- Phương thức bắt buộc: `health`, `load`, `offload` (VRAM → RAM), `unload`, `run`, `cancel`; thông báo `progress {job_id, done, total}`.
- Môi trường Python riêng mỗi engine dưới `<app-data>/providers/python/<engine>/`, phụ thuộc ghim bằng lock file.

## 10. Trình quản lý model và cài đặt

- **Danh mục** `extensions/providers/models.yaml`:

```yaml
- key: qwen-image-2.1-q4
  files:
    - { name: Qwen-Image-2.1-Q4.gguf, url: "<url>", sha256: "<hash>", size: 5960000000, dest: diffusion_models }
    - { name: qwen3vl_8b_w4a8.safetensors, url: "<url>", sha256: "<hash>", size: 6310000000, dest: text_encoders }
    - { name: qwen_image_2.1_vae_bf16.safetensors, url: "<url>", sha256: "<hash>", size: 680000000, dest: vae }
  install_profile: full
  license: { id: qwen-research, url: "https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE", commercial: false }
```
Mục có `license.commercial: false` chỉ cài khi người dùng xác nhận giấy phép (onboarding hiện điều khoản; CLI `--accept-license`); xác nhận ghi vào `settings.json.installed` (018).
URL/sha256 cụ thể điền khi cài thử ở S16.
- **Hồ sơ cài đặt:** `minimal` (agent, HyperFrames, FFmpeg) · `standard` (+ `tts.omnivoice`, `asr`, `audio.analysis`) · `full` (+ ComfyUI, Qwen-Image-2.1, `audio.clap`).
- **Tải:** là job loại `download`; bất biến: báo dung lượng trước, tải tiếp được khi đứt, file chỉ xuất hiện ở đích sau khi khớp `sha256` (`E_DOWNLOAD_CHECKSUM`). Chi tiết: FN-014.
- **Gỡ:** xóa file model không còn provider nào cần; cập nhật `settings.json.installed`.

## 11. Đĩa

- Bất biến: không tự xóa render phát hành, artifact nguồn, `uploads/`, kho nhạc; chỉ dọn dữ liệu dẫn xuất (cache, `.sf/`, render nháp) — tự động theo hạn mức hoặc khi người dùng bấm.
- Dưới ngưỡng đĩa tối thiểu → chặn job sinh/render (`E_DISK_LOW`). Ngưỡng và chính sách giữ bản: FN-024.

## 12. CLI `sf`

Theo constitution Điều III. Mọi lệnh nhận tham số dòng lệnh hoặc JSON từ stdin, in JSON ra stdout, lỗi ra stderr dạng `{code, message}`; mã thoát 0 = thành công, 1 = lỗi nghiệp vụ, 2 = lỗi tham số. Cột **agent** = được gọi qua `script.run`.

| Lệnh | Mô tả | agent |
|---|---|---|
| `sf artifact validate <path>` | Kiểm schema | ✓ |
| `sf artifact migrate <video_dir> [--dry-run]` | Chạy migration | — |
| `sf config resolve <key> [--scene] [--frame]` | Giải cấu hình | ✓ |
| `sf graph status` / `sf graph plan [targets]` | Build graph | ✓ |
| `sf video create <channel_dir> [--title]` | Tạo video (`phase: briefing`) | — |
| `sf tts say --voice <id> --text <t> [--out]` | Sinh một câu (kiểm M0) | — |
| `sf job list` / `sf job cancel <id>` | Job | — |
| `sf channel validate <channel_dir>` | Kiểm hồ sơ kênh (D6 mục 6.3) | ✓ |
| `sf ext build <pack_dir>` | Áp delta lên upstream (D6 mục 8) | — |
| `sf ext validate <pack_dir>` | Kiểm manifest gói (D13) | — |
| `sf model install <key>` / `sf model list` | Trình quản lý model | — |
| `sf test e2e [--workflow <id>]` / `sf test gpu` | Chạy test (D12) | — |
| `sf eval compare --channel <id> --by <field> [--since]` | So sánh model/rubric (D11) | — |

CLI dùng chung code `packages/core`; `core` không cần đang chạy (trừ `job`, dùng `studioflow.db`).

## 13. Mã lỗi

| Mã | Khi | retryable |
|---|---|---|
| `E_PROVIDER_UNAVAILABLE` | Không có provider khả dụng | không |
| `E_PROVIDER_FAILED` | Provider lỗi khi chạy | có |
| `E_GPU_OOM` | Hết VRAM | có (sau khi xả engine khác) |
| `E_JOB_CANCELED` | Bị hủy | không |
| `E_JOB_INTERRUPTED` | App tắt giữa chừng, việc không idempotent | không |
| `E_OWNER_CONFLICT` | Ghi file cảnh khi `owner = studio` | không |
| `E_BASE_HASH_MISMATCH` | File đã đổi so với `base_hash` | không |
| `E_SCOPE_DENIED` | Phiên ghi ngoài `allowed_paths` | không |
| `E_HF_ID_LOST` | HyperFrames làm mất `data-sf-id` | không |
| `E_DISK_LOW` | Đĩa dưới ngưỡng tối thiểu (FN-024) | không |
| `E_DOWNLOAD_CHECKSUM` | Sai sha256 | có |
| `E_BUDGET_EXCEEDED` | Vượt ngân sách token/API | không |
