# D3 — Spec mô hình miền và artifact

**Phiên bản:** 1.3 · **Ngày:** 03/10/2026
**Dựa trên:** `00-architecture.md` mục 4, 5, 14 · **Phủ:** FR-WS-01/03/05, FR-SC-05, FR-VO-02, FR-OB-02, FR-CH-07, NFR-01/02
**Tính năng triển khai:** 002 `domain-artifacts`

Định nghĩa TypeScript trong tài liệu này là **chuẩn**. Tính năng 002 sinh `docs/contracts/domain/*.schema.json` và `packages/core/domain/types.ts` từ đây; không định nghĩa song song ở chỗ khác.

---

## 1. Bố cục thư mục

```
<install>/resources/extensions/     gói đi kèm bản cài (chỉ đọc): studioflow-core, workflow, provider, blueprint, style, output
<app-data>/                         %APPDATA%\StudioFlow\
  settings.json                     cài đặt app (mục 6.2)
  studioflow.db                     SQLite: job, cache toàn cục, trace, chi phí (D4, D11)
  models/                           kho model dùng chung (D4)
  providers/                        môi trường Python, ComfyUI (D4)
  music/                            kho nhạc cấp app: files/, manifest.json, .index/ (D8)
  extensions/                       gói mở rộng người dùng cài thêm (D13)
  logs/

<channel>/                          thư mục kênh do người dùng chọn
  channel.json
  profile/                          hồ sơ kênh, bố cục plugin (D6)
  voices/<voice_id>/                giọng clone + ref audio
  luts/ mouths/ characters/<cast_id>/
  assets/  assets/manifest.json     thư viện asset kênh
  music/                            kho nhạc kênh: files/, manifest.json, .index/ (D8)
  cache/                            cache theo nội dung (D4)
  chat/<session_id>.jsonl           chat cấp kênh (khi chưa chọn video, ví dụ tạo kênh)
  videos/<video_id>/                một video = một HyperFrames project
    hyperframes.json                file project HyperFrames (do adapter quản lý)
    BRIEF.md  frame.md  STORY.md  SCRIPT.md  CAST.md  STORYBOARD.md  publish.md
    audio/lines/<line_id>.wav       audio từng line
    audio_meta.json  caption_groups.json  caption-overrides.json
    lipsync/<line_id>.json
    public/                         asset đã đặt vào video (ảnh, nhạc…)
    compositions/frames/<frame_id>.html
    index.html
    state.json
    reviews/<step_id>/round-<n>.json
    provenance/<sha256-12>.json
    chat/<session_id>.jsonl
    renders/<render_id>/video.mp4  CREDITS.txt  description.txt  render.json
    uploads/<uuid>.<ext>            file người dùng đính kèm (không dẫn xuất)
    .sf/                            dữ liệu dẫn xuất, xóa được (trừ backups/):
      graph.json                    trạng thái build graph (D4 mục 8)
      tmp/  tmp/hf/ (bản tạm + id-map.json cho script HyperFrames)
      snapshots/                    contact sheet, snapshot
      preview/voice.wav  preview/waveform.json   (bảng caption, D9)
      studio-work/<session>/        bản làm việc Studio + base.json (D9)
      backups/<ISO>/…               sao lưu (mục 8)
```

Quy tắc:
- Mọi đường dẫn trong artifact là **tương đối** so với thư mục video (hoặc kênh nếu là artifact cấp kênh), dùng dấu `/`.
- Thư mục `.sf/` là dẫn xuất: xóa đi thì app dựng lại được (trừ `backups/`).
- **File cảnh** (chịu khóa `owner`, D9): `compositions/**`, `index.html`, `hyperframes.json`, `caption-overrides.json`.
- Tên file theo ID; nếu script HyperFrames cần tiền tố `NN-`, adapter tạo bản tạm trong `.sf/tmp/` (D4 mục HyperFrames adapter) `[chờ S3]`.

## 2. ID

| Thực thể | Tiền tố | Ví dụ |
|---|---|---|
| Channel | `ch_` | `ch_k3v9q2xa` |
| Video | `vd_` | `vd_8m2pq7rt` |
| Beat | `bt_` | `bt_4nd8w1zc` |
| Scene | `sc_` | `sc_p0q2m5ka` |
| Frame | `fr_` | `fr_9x2b7cqe` |
| Layer / phần tử HTML | `el_` | `el_t5w8n3ja` |
| Line | `ln_` | `ln_2r7c4kxm` |
| Caption group | `cg_` | `cg_m1x8d0rq` |
| Cast member | `ca_` | `ca_a7f2k9wd` |
| Voice | `vo_` | `vo_c3z8p1mn` |
| Asset | `as_` | `as_h6k2q9vt` |
| Music track | `mt_` | `mt_w4j7r2bd` |
| Job | `jb_` | `jb_…` |
| Render | `rd_` | `rd_…` |
| Approval | `ap_` | `ap_…` |
| Chat session | `ss_` | `ss_…` (ID của app; ID phiên của Agent SDK lưu kèm trong file chat) |

- Định dạng: `<tiền tố>_<8 ký tự [0-9a-z]>`, sinh ngẫu nhiên (crypto), kiểm trùng trong phạm vi video/kênh.
- ID **không bao giờ đổi** và không dùng lại sau khi xóa. Thứ tự dựa trên trường `order`/danh sách, không dựa trên ID.
- Word không có ID riêng: tham chiếu bằng `(line_id, word_index)`.

## 3. Kiểu dùng chung

```ts
type Id<P extends string> = `${P}_${string}`;
type ChannelId = Id<'ch'>; type VideoId = Id<'vd'>; type BeatId = Id<'bt'>;
type SceneId = Id<'sc'>; type FrameId = Id<'fr'>; type ElementId = Id<'el'>;
type LineId = Id<'ln'>; type CaptionGroupId = Id<'cg'>; type CastId = Id<'ca'>;
type VoiceId = Id<'vo'>; type AssetId = Id<'as'>; type MusicTrackId = Id<'mt'>;

type RelPath = string;          // đường dẫn tương đối, '/'
type JobId = Id<'jb'>; type RenderId = Id<'rd'>; type ApprovalId = Id<'ap'>; type SessionId = Id<'ss'>;
type Iso8601 = string;          // '2026-10-03T10:49:00+07:00'
type Ms = number;               // mili giây, số nguyên
type Lang = 'vi' | 'de' | 'en';
type Sha256 = string;           // hex 64 ký tự

interface Versioned { schema_version: number; }
```

## 4. Mô hình miền

```ts
interface Beat {            // khai báo trong SCRIPT.md
  id: BeatId; order: number; title: string;
  line_ids: LineId[];
}

interface Line {            // khai báo trong SCRIPT.md
  id: LineId; beat_id: BeatId; order: number;
  speaker: 'narrator' | CastId;
  text: string;             // chữ hiển thị/caption
  tts_text?: string;        // chữ đã chuẩn hóa cho TTS (số, viết tắt) nếu khác text
  direction?: string;       // chỉ dẫn diễn xuất, ví dụ "chậm, trầm"
  emotion?: string;         // khóa biến thể cảm xúc của giọng
  pause_after_ms?: Ms;
}

interface Scene {           // khai báo trong STORYBOARD.md
  id: SceneId; order: number; title: string;
  setting?: string; time_of_day?: string; mood?: string;
  look?: string;            // khóa look trong hồ sơ kênh
  music?: 'none' | { track_id?: MusicTrackId; query?: string; volume_db?: number };
  frame_ids: FrameId[];
  config?: Record<string, unknown>;   // ghi đè cấu hình tầng scene
}

interface Frame {           // khai báo trong STORYBOARD.md
  id: FrameId; scene_id: SceneId; order: number;
  beat_ids: BeatId[];       // Beat–Frame nhiều–nhiều
  line_ids: LineId[];       // line phát trong frame; mỗi line thuộc ĐÚNG MỘT frame (thời lượng frame suy từ audio)
  blueprint?: string;       // id blueprint (D13)
  intent: string;           // mô tả ý đồ hình ảnh/chuyển động
  layers: Layer[];
  transition_in?: { type: string; duration_ms: Ms };
  effects?: string[];       // id media effect
  overlays?: { block: string; vars: Record<string, string> }[];
  lipsync?: { cast_id: CastId; mouth_anchor: ElementId };
  sfx?: { track_id: MusicTrackId; at_ms: Ms; volume_db?: number }[];   // at_ms tương đối đầu frame (D8)
  min_duration_ms?: Ms;     // khi frame không có line
  config?: Record<string, unknown>;
}

interface Layer {
  id: ElementId;
  kind: 'background' | 'image' | 'object' | 'text' | 'shape' | 'chart' | 'overlay' | 'mouth';
  asset_id?: AssetId;       // ảnh/vật thể
  asset_request?: AssetRequest;  // khi chưa có asset: mô tả để bước assets xử lý
  text?: string;
  notes?: string;
}

interface AssetRequest {
  source: 'library' | 'code' | 'generate' | 'user';
  prompt?: string; reference_asset_ids?: AssetId[];
  transparent?: boolean; aspect?: '16:9' | '9:16' | '1:1' | '4:3';
}

interface CastMember {      // CAST.md (video) hoặc characters/<id>/cast.json (kênh)
  id: CastId; name: string; role: 'narrator' | 'character';
  voice_id: VoiceId; emotions?: Record<string, RelPath>;   // khóa → ref audio
  reference_images: AssetId[];
  expressions?: Record<string, AssetId>;   // file ở characters/<cast_id>/expressions/<key>.png, đăng ký trong assets/manifest.json của kênh
  mouth_set?: string;                      // file: mouths/<set>/<view>/<state>.svg, view ∈ front|three_quarter, state ∈ closed|half|open
  mouth_anchor?: { x: number; y: number; scale: number };
  caption_color?: string;   // hex
}

interface OutputProfile {   // extensions/outputs/<id>/output.json
  id: string; width: number; height: number; fps: number;
  safe_area: { top: number; right: number; bottom: number; left: number }; // tỉ lệ 0–1
  max_duration_ms?: Ms;
  video: { codec: 'h264'; crf: number }; audio: { codec: 'aac'; sample_rate: 48000; loudness_lufs: number };
}
```

Output profile có sẵn: `yt-1080p30`, `yt-shorts-1080x1920` (thông số: PRD mục 5).

## 5. Định dạng artifact

### 5.1 Markdown có khối dữ liệu
Các file `.md` có cấu trúc dùng **front matter YAML** + **khối mã có nhãn** `sf-*`. Parser chỉ đọc front matter và khối `sf-*`; văn xuôi xung quanh được giữ nguyên khi ghi lại (round-trip). Ghi lại một khối chỉ thay nội dung khối đó.

### 5.2 `BRIEF.md`

```markdown
---
schema_version: 1
video_id: vd_8m2pq7rt
proposed_workflow: { id: narrated-explainer, version: 1.0.0 }   # đề xuất của router; nguồn chính thức là state.json sau khi duyệt brief
proposed_output_profile: yt-1080p30
source_video_id: null          # shorts cắt từ video dài (FN-030)
language: vi
target_duration_ms: 600000
title_working: "…"
approved_at: null
---
# Brief
<văn xuôi: chủ đề, khán giả, góc nhìn, thông điệp chính, nguồn tham khảo, điều cần tránh>
```

### 5.3 `frame.md`
Design system của video theo định dạng HyperFrames `[chờ S3]`. Sinh từ `profile/` + `channel.json` ở bước `design-system`; có front matter `schema_version`, `generated_from` (hash hồ sơ kênh). Không sửa tay.

### 5.3b `STORY.md`
Dàn ý câu chuyện (bước `script` với `mode: outline`, chỉ `short-film`). Front matter `schema_version`, `video_id`, `status`; mỗi scene dự kiến là một heading `##` kèm khối `sf-story` (YAML: `title`, `summary`, `characters: string[]`, `setting`, `beats: string[]`). Không có line/ID line; `SCRIPT.md` (screenplay) được viết từ file này.

### 5.4 `SCRIPT.md`

```markdown
---
schema_version: 1
video_id: vd_8m2pq7rt
language: vi
status: draft | approved
---
## Mở đầu <!-- sf:beat id=bt_4nd8w1zc -->

<!-- sf:line id=ln_2r7c4kxm speaker=narrator emotion=calm pause_after_ms=300 -->
Năm 1428, Lê Lợi lên ngôi.
<!-- sf:tts text="Năm một nghìn bốn trăm hai mươi tám, Lê Lợi lên ngôi." -->

<!-- sf:line id=ln_9w3b6tqa speaker=ca_a7f2k9wd direction="giọng run" -->
Bệ hạ…
```

Quy tắc:
- Mỗi heading `##` có marker `sf:beat` là một beat; thứ tự theo vị trí trong file.
- Một line = marker `sf:line` + đoạn văn ngay sau (đến dòng trống). Marker `sf:tts` tùy chọn ngay sau đoạn.
- Line mới do producer viết chưa có ID: parser gán ID khi `artifact.write` và trả bản đã gán.
- Sửa chữ của line giữ nguyên ID → build graph biết chỉ line đó đổi.

### 5.5 `STORYBOARD.md`

````markdown
---
schema_version: 1
video_id: vd_8m2pq7rt
status: draft | approved
---
## Scene 1 — Kinh thành Thăng Long
```sf-scene
id: sc_p0q2m5ka
title: Kinh thành Thăng Long
mood: trang nghiêm
look: warm-archive
music: { query: "trang nghiêm, chậm, đàn tranh", volume_db: -18 }
```

### Frame 1
```sf-frame
id: fr_9x2b7cqe
beat_ids: [bt_4nd8w1zc]
line_ids: [ln_2r7c4kxm]
blueprint: title-over-map
intent: "Bản đồ Đại Việt hiện dần, chữ năm 1428 trượt vào"
layers:
  - { id: el_t5w8n3ja, kind: background, asset_request: { source: generate, prompt: "bản đồ cổ Đại Việt, giấy dó", aspect: "16:9" } }
  - { id: el_q2k7m4zp, kind: text, text: "1428" }
transition_in: { type: crossfade, duration_ms: 600 }
```
<ghi chú văn xuôi tùy ý>
````

- Thứ tự scene/frame theo vị trí trong file; trường `order` trong mô hình được suy ra.
- `STORYBOARD.md` là **nguồn duy nhất cho nội dung và cấu trúc** (D9 mục 1). Adapter sinh định dạng storyboard HyperFrames cần (bản tạm) nếu khác `[chờ S3]`.

### 5.6 `CAST.md`
Front matter + một khối `sf-cast` (YAML danh sách `CastMember`) + văn xuôi mô tả nhân vật. Cast cấp kênh nằm ở `characters/<cast_id>/cast.json`; `CAST.md` của video chỉ tham chiếu `id` và có thể ghi đè trường.

### 5.7 `audio_meta.json`

```ts
interface AudioMeta extends Versioned {
  video_id: VideoId; sample_rate: 48000;
  lines: {
    line_id: LineId; file: RelPath;            // audio/lines/<line_id>.wav
    start_ms: Ms; duration_ms: Ms;             // vị trí trên **chuỗi lời đọc** (các line nối theo thứ tự SCRIPT + pause_after_ms), không tính frame không lời; mốc tuyệt đối trên video do nút frame_timing tính (D4 mục 8)
    speaker: 'narrator' | CastId; voice_id: VoiceId;
    words: { i: number; text: string; start_ms: Ms; end_ms: Ms; conf?: number }[]; // tương đối với đầu line
    asr_wer?: number; asr_flag?: 'ok' | 'mismatch' | 'accepted';   // accepted = người dùng chấp nhận dù lệch; asr_regen_count?: number
    content_hash: Sha256;                      // hash đầu vào sinh audio (D4 cache key)
  }[];
  total_duration_ms: Ms;
}
```
Định dạng mà `audio.mjs`/`captions.mjs` của HyperFrames cần được adapter chuyển đổi `[chờ S3]`.

### 5.8 `caption_groups.json` và `caption-overrides.json`

```ts
interface CaptionGroups extends Versioned {
  video_id: VideoId; style: string;            // id thành phần caption catalog
  groups: { id: CaptionGroupId; line_id: LineId; word_range: [number, number]; // [đầu, cuối] chỉ số word, gồm cả hai đầu
            text: string; start_ms: Ms; end_ms: Ms; emphasis?: number[]; speaker?: string }[];
}

interface CaptionOverrides extends Versioned {
  video_id: VideoId;
  style?: { component?: string; vars?: Record<string, string> };    // từ Studio
  groups: Record<CaptionGroupId, {
    start_ms?: Ms; end_ms?: Ms; text?: string;                    // từ bảng caption
  }>;
  splits: { group_id: CaptionGroupId; at_word: number; new_id: CaptionGroupId }[];
  merges: { group_ids: CaptionGroupId[]; new_id: CaptionGroupId }[];
}
```
`caption_groups.json` là dẫn xuất (sinh lại được); `caption-overrides.json` là nguồn cho chỉnh tay và được áp sau khi sinh. Override trỏ tới group đã biến mất → giữ lại, đánh dấu `orphan` trong `graph.status`, hiển thị cho người dùng.

### 5.9 `lipsync/<line_id>.json`

```ts
interface LipsyncCues extends Versioned {
  line_id: LineId; cast_id: CastId; fps: number;
  cues: { frame: number; mouth: 'closed' | 'half' | 'open' }[];   // video frame tương đối đầu line
}
```

### 5.10 `state.json`

```ts
interface VideoState extends Versioned {
  video_id: VideoId; channel_id: ChannelId;
  created_at: Iso8601; updated_at: Iso8601;
  phase: 'briefing' | 'workflow';           // briefing: chưa chọn workflow (D6 mục 3.0)
  workflow: { id: string; version: string } | null;   // nguồn chính thức; null khi briefing
  output_profile: string | null;            // nguồn chính thức (khóa output.profile tầng video đọc từ đây)
  read_only_videos?: VideoId[];             // video khác được đọc (shorts từ video dài)
  owner: 'agent' | 'studio';                 // chủ sửa file cảnh hiện tại
  owner_since?: Iso8601;
  steps: Record<string, StepState>;          // khóa = step id trong manifest
  approvals: Approval[];
  pinned_frames: Record<FrameId, ManualDelta>;
  config_overrides: Record<string, unknown>; // tầng video (mục 7)
  budget: { tokens_used: number; api_cost_usd: number; limits?: { tokens?: number; api_cost_usd?: number } };
}

interface StepState {
  status: 'pending' | 'running' | 'waiting_approval' | 'done' | 'failed' | 'skipped' | 'stale';
  started_at?: Iso8601; finished_at?: Iso8601;
  attempt: number; error?: { code: string; message: string };
  outputs?: RelPath[];
  refine?: { rounds: number; final_score?: number; incomplete?: boolean };
}

interface Approval {
  id: ApprovalId; step_id: string; status: 'pending' | 'approved' | 'changes_requested';
  requested_at: Iso8601; decided_at?: Iso8601; note?: string;
  artifact_hashes: Record<RelPath, Sha256>;   // nội dung đã duyệt; đổi hash → duyệt mất hiệu lực
}

interface ManualDelta {
  pinned_at: Iso8601; base_hash: Sha256;      // hash HTML frame do agent sinh trước khi chỉnh tay
  changes: { element_id: ElementId | '*'; attr: string; before: string | null; after: string | null }[];   // '*' = nhận cả frame (D9 mục 3.4 c)
}
```

### 5.11 `reviews/<step_id>/round-<n>.json`

```ts
interface ReviewRound extends Versioned {
  step_id: string; round: number; artifact: RelPath; draft_hash: Sha256;
  producer: { provider: string; model: string };
  critic: { provider: string; model: string };
  objective_checks: { id: string; pass: boolean; detail?: string }[];
  score: number;                             // 0–10
  criteria: { id: string; score: number; weight: number; note?: string }[];
  issues: { severity: 'critical' | 'major' | 'minor'; location?: string; text: string; fixed_in_round?: number }[];
  tokens: { input: number; output: number }; cost_usd: number; created_at: Iso8601;
}
```

### 5.12 Provenance

```ts
interface Provenance extends Versioned {
  output: RelPath; output_hash: Sha256;      // file tên provenance/<12 ký tự đầu output_hash>.json
  capability: string; provider: string; provider_version: string;
  model?: { id: string; file_hash?: Sha256 };
  params: Record<string, unknown>; seed?: number;
  inputs: { path?: RelPath; hash: Sha256; role: string }[];
  cache_key: Sha256; from_cache: boolean;
  source?: { kind: 'generated' | 'user_import' | 'library'; url?: string; attribution?: string };
  job_id?: string; created_at: Iso8601;
}
```

### 5.13 Manifest asset và nhạc

```ts
interface AssetManifest extends Versioned {
  assets: { id: AssetId; file: RelPath; kind: 'image' | 'video' | 'svg' | 'audio';
            width?: number; height?: number; alpha?: boolean; tags: string[];
            description?: string; source: Provenance['source']; hash: Sha256; created_at: Iso8601 }[];
}
```
Manifest nhạc: D8.

### 5.14 `renders/<render_id>/render.json`

```ts
interface RenderRecord extends Versioned {
  id: RenderId; mode: 'animatic' | 'draft' | 'release'; output_profile: string;
  started_at: Iso8601; finished_at?: Iso8601; status: 'running' | 'done' | 'failed' | 'canceled';
  file?: RelPath; duration_ms?: Ms; gate_results: { gate: string; pass: boolean; detail?: string }[];
  index_hash: Sha256;
}
```
`CREDITS.txt`: văn bản thuần UTF-8, mỗi mục một đoạn; định dạng ở D8.

### 5.15 `publish.md`
Tiêu đề, mô tả, thẻ, chương cho YouTube (bước `publish-meta`, D6). Front matter: `schema_version`, `video_id`, `title`, `tags: string[]`, `chapters: {start_ms, title}[]`, `status`; thân file là mô tả video. Khi render phát hành, `CREDITS.txt` được nối vào cuối mô tả trong bản xuất `renders/<rd>/description.txt`.

### 5.16 Chat log
`chat/<session_id>.jsonl`, mỗi dòng một sự kiện `{ts, role: 'user'|'assistant'|'tool'|'system', content, tool?: {name, input, output_summary}}`. Chỉ ghi thêm (append-only), không qua build graph.

## 6. `channel.json` và `settings.json`

Mọi giá trị cấu hình (ở mọi tầng) lưu dưới dạng **map phẳng theo khóa cấu hình** (mục 7.2) — một biểu diễn duy nhất, không có tên trường riêng theo file.

### 6.1 `channel.json`

```ts
interface ChannelConfig extends Versioned {
  id: ChannelId; name: string; language: Lang; created_at: Iso8601;
  profile_dir: 'profile';
  config: Partial<Record<ConfigKey, unknown>>;     // tầng channel, ví dụ { "voice.id": "vo_…", "look.id": "warm-archive" }
}
```

### 6.2 `<app-data>/settings.json`

```ts
interface SettingsConfig extends Versioned {
  config: Partial<Record<ConfigKey, unknown>>;     // tầng app (mặc định của người dùng; thiếu khóa → mặc định trong bảng 7.2)
  installed: { profile: 'minimal' | 'standard' | 'full'; components: { id: string; version: string; installed_at: Iso8601; license_accepted?: string }[] };   // license_accepted: id giấy phép người dùng đã xác nhận (018)
  provider_fallbacks: Partial<Record<string, string[]>>;   // capability → danh sách provider id theo thứ tự
  provider_settings?: Partial<Record<string, Record<string, unknown>>>;   // cấu hình riêng provider không bí mật (ví dụ endpoint workspace của `image.qwen20-api`, 018)
  network: { allow: string[] };                    // domain cho phép (D5 mục 5.3)
  pricing: { provider: string; model: string; unit: 'mtok_in' | 'mtok_out' | 'image' | 'second'; usd: number }[];
  trace: { capture_content: boolean; retention_days: number; phoenix_enabled: boolean };   // mặc định true / 30 / false
  recent_channels: { path: string; opened_at: Iso8601 }[];
}
```

## 7. Cấu hình theo tầng

### 7.1 Tầng và nguồn
`app` (`settings.json`.config) → `channel` (`channel.json`.config) → `workflow` (`config_defaults` trong `workflow.yaml` của workflow đã chọn, D6 mục 1.2; giá trị riêng của dạng video như caption dọc của shorts) → `video` (`state.json`.config_overrides; riêng `output.profile` đọc từ `state.json.output_profile`) → `scene` (`sf-scene`.config) → `frame` (`sf-frame`.config). Tầng sau ghi đè tầng trước theo khóa. Thiếu ở mọi tầng → giá trị mặc định (tech-defaults mục 7).

### 7.2 Khóa cấu hình
`type ConfigKey` = các khóa trong bảng (khóa có `<…>` là mẫu). Thêm khóa = thêm dòng vào bảng (tăng phiên bản tài liệu).

| Khóa | Kiểu | Tầng cho phép |
|---|---|---|
| `output.profile` | string | app, channel, video |
| `workflow.default` | string | app, channel |
| `voice.id` | VoiceId | channel, video |
| `voice.pause_after_ms` | Ms | channel, video |
| `look.id` | string | mọi tầng |
| `font.family` | string | app, channel |
| `caption.style` | string | channel, video |
| `caption.max_words` | number | channel, video |
| `overlay.rules` | string[] | channel |
| `provider.<capability>` | string | app, channel, video |
| `text.producer` / `text.critic` / `text.aux` | string (`<provider>/<model>`) | app, channel, video |
| `refine.min_rounds` / `refine.max_rounds` / `refine.threshold` | number | channel, video |
| `frame.min_duration_ms` | Ms | channel, video, scene, frame |
| `frame_build.parallel` | number | app |
| `budget.tokens_per_video` | number | app, channel, video |
| `budget.api_cost_usd_per_video` | number | app, channel, video |
| `budget.cache_gb` | number | channel |
| `music.volume_db` | number | channel, video, scene |
| `music.duck_db` | number | channel, video |
| `asr.wer_threshold.<lang>` | number | app, channel |
| `asr.max_regen` | number | app, channel |
| `lipsync.enabled` | boolean | channel, video, frame |
| `policy.auto_approve.batch_gen` | boolean | video |
| `policy.auto_approve.paid_api` | boolean | video |
| `check.duration_tolerance` | number (tỉ lệ) | channel, video |
| `meta.title_max` / `meta.description_max` | number (ký tự) | channel, video |
| `meta.hashtags` | string[] | channel, video |
| `policy.batch.tts_lines` / `policy.batch.images` | number | app |
| `policy.paid_api.per_call_usd` | number | app |
| `policy.budget_warn_ratio` | number (tỉ lệ) | app |
| `gpu.vram_budget_gb.<engine>` / `gpu.vram_total_gb` | number | app |

Giá trị mặc định của từng khóa: `tech-defaults.md` mục 7 (đổi mặc định không phải đổi spec hệ thống).

### 7.3 API bộ giải

```ts
interface ResolvedValue<T> { value: T; source: 'default' | 'app' | 'channel' | 'video' | 'scene' | 'frame'; path: string; }
function resolveConfig<T>(key: ConfigKey, scope: { channel: ChannelId; video?: VideoId; scene?: SceneId; frame?: FrameId }): ResolvedValue<T>;
```
Tool `config.resolve` (D4), template trong hồ sơ kênh (`{{config:<khóa>}}`, D6 mục 6.1) và UI dùng chung hàm này. Khóa không có trong bảng → `E_CONFIG_UNKNOWN_KEY`; đặt khóa ở tầng không cho phép → `E_CONFIG_SCOPE`.

## 8. Ghi, kiểm tra, migration

- **Đường ghi duy nhất:** mọi lần ghi vào kênh/video/kho nhạc app đi qua **module ghi của Gateway** trong `core`. Các lối vào của module này: tool `artifact.write`, `studio.commit`, kết quả capability (job ghi file đầu ra), `upload.ingest` (IPC, file đính kèm → `uploads/`), ghi nội bộ của `music.library.add` vào kho app. Không thành phần nào khác ghi file.
- **Ghi nguyên tử:** ghi `.sf/tmp/<uuid>` (hoặc thư mục tạm cùng ổ với đích) → `fsync` → đổi tên đè (`fs.rename`). Không bao giờ ghi trực tiếp vào file đích. File nhị phân (audio, ảnh) dùng cùng cơ chế.
- **Nhật ký ghi:** module ghi lưu `(path, hash, by, ts)` để file watcher phân biệt ghi trong/ngoài app (D9 mục 3.6).
- **Kiểm tra:** mọi artifact có schema được kiểm (`artifact.validate`) trước khi ghi; lỗi trả `E_SCHEMA_INVALID` kèm đường dẫn trường.
- **Hash:** `sha256` của nội dung file (văn bản chuẩn hóa xuống dòng `\n`); dùng cho `base_hash`, approval, cache.
- **Sao lưu:** trước migration và trước ghi đè artifact đã duyệt hoặc frame đã ghim: chép vào `.sf/backups/<ISO>/<path>`; giữ 20 bản gần nhất mỗi file.
- **Migration:** mỗi artifact có `schema_version` (bắt đầu 1). Khi mở video, nếu nhỏ hơn bản hiện tại: sao lưu → chạy lần lượt `migrate_<artifact>_<n>_to_<n+1>` → kiểm schema → ghi. Migration là hàm thuần, có test với file mẫu mỗi phiên bản. Phiên bản lớn hơn app hiểu → mở chế độ chỉ đọc, báo `E_SCHEMA_TOO_NEW`.
- **Nhận diện kênh (FR-WS-01):** thư mục có `channel.json` hợp lệ → kênh. Không có → đề nghị khởi tạo (tạo `channel.json`, `profile/` mẫu, thư mục con).
- **Tạo video:** IPC `video.create {title?}` tạo `videos/<vd>/`, `state.json` với `phase: 'briefing'`, `workflow: null`, `output_profile: null` (D6 mục 3.0).

## 9. Mã lỗi

| Mã | Khi |
|---|---|
| `E_SCHEMA_INVALID` | Artifact không qua schema |
| `E_SCHEMA_TOO_NEW` | `schema_version` lớn hơn app hỗ trợ |
| `E_ID_DUPLICATE` | Trùng ID trong phạm vi |
| `E_ID_UNKNOWN` | Tham chiếu ID không tồn tại |
| `E_PARSE_MARKER` | Marker `sf:*` hoặc khối `sf-*` sai cú pháp |
| `E_CONFIG_UNKNOWN_KEY` | Khóa cấu hình không có trong bảng |
| `E_CONFIG_SCOPE` | Đặt khóa ở tầng không cho phép |
| `E_UPLOAD_TOO_LARGE` | File đính kèm > 200 MB |
| `E_PATH_OUTSIDE` | Đường dẫn ra ngoài thư mục video/kênh |
