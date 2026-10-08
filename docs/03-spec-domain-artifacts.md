# D3 — Spec mô hình miền và artifact

**Phiên bản:** 1.3 · **Ngày:** 03/10/2026
**Dựa trên:** `00-architecture.md` mục 4, 5, 14 · **Phủ:** FR-WS-01/03/05, FR-SC-05, FR-VO-02, FR-OB-02, FR-CH-07, NFR-01/02
**Tính năng triển khai:** 002 `domain-artifacts`

Định nghĩa TypeScript trong tài liệu này là **chuẩn**. Tính năng 002 sinh `docs/contracts/domain/*.schema.json` và `packages/core/domain/types.ts` từ đây; không định nghĩa song song ở chỗ khác.

---

## 1. Bố cục thư mục

```
<install>/resources/extensions/     gói đi kèm bản cài (chỉ đọc): studioflow-core, workflow, provider, blueprint, style, output
<app-data>/                         %APPDATA%\StudioFlow Agent\ (069; bản trước %APPDATA%\StudioFlow\, đổi tên một lần)
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
  voices/<voice_id>/                giọng clone hoặc giọng gợi ý từ mô tả (033) + ref audio, profile.json
  luts/ mouths/ characters/<cast_id>/
  assets/  assets/manifest.json     thư viện asset kênh
  music/                            kho nhạc kênh: files/, manifest.json, .index/ (D8)
  cache/                            cache theo nội dung (D4)
  chat/<session_id>.jsonl           chat cấp kênh (khi chưa chọn video, ví dụ tạo kênh)
  research/<YYYY-MM-DD>.json        quét nghiên cứu Autopilot theo ngày (049, mục 5.17): đối thủ, trending, tin nóng → chủ đề chấm điểm
  autopilot/plans/<YYYY-MM-DD>.json kế hoạch ngày Autopilot (051, mục 5.18): chủ đề, workflow, khung giờ đăng, lý do
  autopilot/reports/<YYYY-MM-DD>.json báo cáo ngày của kênh (054, mục 5.20): số liệu, sản xuất, đăng bài, chi phí
  autopilot/learning.json           điều chỉnh điểm chủ đề học từ hiệu quả thật (057, mục 5.21)
  autopilot/log/<YYYY-MM-DD>.jsonl  nhật ký vận hành Autopilot (052, mục 5.19): mỗi quyết định tự động một dòng, kèm lý do (append-only)
  .trash/<vd>-<YYYYMMDDHHmmss>/     (064) video đã xóa (thùng rác, khôi phục được; tự dọn sau trash.retention_days ngày) + trash.json
  videos/<video_id>/                một video = một HyperFrames project
    hyperframes.json                file project HyperFrames (do adapter quản lý)
    BRIEF.md  frame.md  STORY.md  SCRIPT.md  CAST.md  STORYBOARD.md  publish.md
    REFERENCE.md                    (tùy chọn, 044) phân tích video YouTube tham khảo: công thức nội dung, không chép nội dung; markdown tự do, không qua schema
    .sf/paid.json                   (052) sổ lệnh API có phí được Autopilot tự cho phép trong ngân sách video: {approved_usd, calls[]}
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
| Plan item (051) | `pi_` | `pi_…` (một mục trong kế hoạch ngày Autopilot) |

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
type JobId = Id<'jb'>; type RenderId = Id<'rd'>; type ApprovalId = Id<'ap'>; type SessionId = Id<'ss'>; type PlanItemId = Id<'pi'>;
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
  autopilot?: { plan_date: string; item_id: PlanItemId; channel_id: ChannelId };  // 052: video do Autopilot tạo theo mục kế hoạch ngày (đánh dấu để áp cổng chất lượng tự động; video làm tay không có trường này)
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
  waived?: string[];                       // 043: kiểm mềm (objective `audio_duration`) người dùng chấp nhận bỏ qua; mất khi chạy lại bước
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
`chat/<session_id>.jsonl`, mỗi dòng một sự kiện `{ts, role: 'user'|'assistant'|'tool'|'system', content, tool?: {name, input, output_summary}, notice?}`. Chỉ ghi thêm (append-only), không qua build graph.

`notice` (041): dòng do app ghi khi bước workflow đổi trạng thái — `{event: 'started'|'done'|'waiting'|'failed'|'finished', step_id, step_title, position: [i, n], next?: {id, title}, auto_approved?, approval_id?, outputs?, error?}`; `role` là `assistant`, `content` là câu báo tình trạng. Giao diện vẽ dòng này thành thẻ có nút hành động (xem kết quả, Duyệt, Kiểm tra lại/Chạy lại, Xem video).


**Nhật ký phiên con (048, FR-AP-14):** phiên agent không phải `main` (frame, producer, critic…) ghi cùng định dạng dòng vào `videos/<vd>/sessions/<session_id>.jsonl` (kênh: `sessions/`); dòng đầu `role: system` có `session: {id, kind, video_id?, frame_id?}`; dòng `tool` có thêm `tool.ok`; dòng kết thúc có `usage: {input_tokens, output_tokens}`. Chỉ ghi thêm, không qua build graph, không bị dọn đĩa (nhật ký kiểm tra).

Phiên `ops` (055, agent trả lời câu hỏi vận hành qua Telegram) không thuộc kênh nào: nhật ký lưu ở thư mục dữ liệu app `ops/sessions/<session_id>.jsonl` (cùng định dạng dòng chat); vị trí đọc offset getUpdates của bot: `telegram/offset.json` (`{offset}`, dữ liệu app, không chứa bí mật).

### 5.17 `research/<YYYY-MM-DD>.json` (049)
Kết quả quét nghiên cứu mỗi ngày của một kênh (FR-AP-04): đối thủ (video mới + video nổi bật cũ), video đã làm của kênh, video trending, Google Trends, Google News theo chủ đề trụ cột; mỗi chủ đề ứng viên có điểm 0–100 và lý do. Ngày theo `publish.timezone`; quét lại trong ngày ghi đè file của ngày đó. Nguồn lỗi không làm hỏng cả lần quét: ghi vào `sources.*.error`. Hằng số chấm điểm: FN-049.

```ts
interface ResearchDoc extends Versioned {
  channel_id: ChannelId;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  date: string;                                    // YYYY-MM-DD theo `publish.timezone`
  generated_at: Iso8601;
  quota_units: number;                             // đơn vị quota YouTube Data API v3 đã dùng
  sources: {
    competitors: { channel_id: string; title?: string; videos: number; error?: ResearchSourceError }[];
    own_videos: number;                            // số video đã làm của kênh dùng để chấm độ mới
    trending: { region: string; videos: number; error?: ResearchSourceError };
    trends: { geo: string; items: number; error?: ResearchSourceError };
    news: { pillar: string; items: number; error?: ResearchSourceError }[];
  };
  candidates: ResearchCandidate[];                 // điểm cao trước
}
interface ResearchSourceError { code: string; message: string; }
interface ResearchCandidate {
  id: string;                                      // `yt:<video_id>` / `trend:<từ khóa>` / `news:<sha256-12 của link>`
  kind: 'competitor' | 'competitor_evergreen' | 'trending' | 'trend' | 'news';
  title: string; url?: string; source_channel?: { id: string; title: string };
  published_at?: Iso8601; pillar?: string;         // chủ đề trụ cột khớp nhất
  metrics?: { views?: number; likes?: number; comments?: number; duration_s?: number;
              outlier_ratio?: number; views_per_hour?: number; age_hours?: number;
              traffic?: number; similarity?: number };
  /** @minimum 0 @maximum 100 */
  score: number;
  reasons: string[];                               // tiếng Việt, mỗi tín hiệu một câu
}
```

### 5.18 `autopilot/plans/<YYYY-MM-DD>.json` (051)
Kế hoạch ngày của một kênh Autopilot (FR-AP-06): mỗi mục là một video dự định làm hôm nay — chủ đề, góc nhìn, workflow + dạng xuất, khung giờ đăng, lý do. Ngày theo `publish.timezone` của kênh. Bộ lập kế hoạch chỉ lấy ứng viên từ `research/<ngày>.json` (5.17) trong giới hạn của mô hình năng lực (050) và `autopilot.max_per_day`; **`autopilot.max_per_day` chỉ đếm video do Autopilot tạo — kế hoạch ngày là nguồn sự thật cho số đó** (video làm tay không tính). Ứng viên có điểm thấp hơn `autopilot.min_score` (mặc định 40) không được lập. Chỗ trống được lấp trước bằng mục `planned` chưa làm của kế hoạch ngày ngay trước (mục cũ chuyển sang `skipped`, `note: "chuyển sang <ngày>"`), rồi mới đến ứng viên mới. Lập lại trong ngày giữ nguyên mọi mục đã có và chỉ lấp chỗ còn trống; mục `in_production` / `produced` / `failed` / `needs_review` không bị sửa bởi bộ lập kế hoạch và người dùng (052 chuyển trạng thái và điền `video_id`: `in_production` khi bắt đầu làm; `produced` khi bước cuối xong; `failed` khi lỗi không cứu được; `needs_review` khi bị **đỗ** vì cần người — cổng chất lượng không đạt, thiếu giọng đọc, cần xác nhận chi phí; lý do ở `note`). Mục `needs_review` / `failed` có video nên vẫn tính vào `autopilot.max_per_day`. Người dùng sửa mục `planned` / `skipped` qua IPC `autopilot.plan.update`.

**Đăng bài (053, FR-AP-09):** mục `produced` được bộ đăng (Publisher) xử lý và ghi `publish.<nền tảng>`: `pending` (chờ tải lên: chưa kết nối OAuth, ngoài khung giờ làm việc…), `uploading`, `private` (đã tải lên riêng tư, **không** hẹn giờ vì `publish.youtube.audited` = false — người dùng tự công khai trong YouTube Studio), `scheduled` (riêng tư + `publishAt`, nền tảng tự công khai; có `veto_until`), `public`, `cancelled` (người dùng bấm Hủy đăng — video vẫn riêng tư), `failed`. Giờ công khai thật = max(`publish_at` của mục, lúc tải lên + `publish.veto_hours`). Trạng thái chỉ do Publisher ghi (qua `markPlanItem`), người dùng không sửa tay. Dữ liệu app (không thuộc kênh): `<app-data>/youtube/quota.json` (`{date, units}` theo ngày Thái Bình Dương — lúc Google đặt lại quota) và `<app-data>/publish/sessions/<item_id>.json` (URI phiên tải lên có thể tiếp tục, không chứa token). **TikTok / Facebook (056, FR-AP-10):** cùng trạng thái. Chỉ video dọc 9:16 (hồ sơ xuất có chiều cao > chiều rộng, ví dụ `yt-shorts-1080x1920`); bản ngang bị bỏ qua (`cancelled`, `note: "Bỏ qua …"`). TikTok không hẹn giờ được: `publish.tiktok.audited` = false → bài `SELF_ONLY` (`private`, người dùng tự công khai); = true → bài chỉ được đăng công khai khi tới giờ công khai (chưa tới giờ: không tải lên, mục ở trạng thái `pending`). Facebook Reels hẹn giờ được (`scheduled`). Luật chọn workflow, khung giờ: FN-051.

```ts
type PlanItemStatus = 'planned' | 'skipped' | 'in_production' | 'produced' | 'failed' | 'needs_review';
interface DailyPlan extends Versioned {
  channel_id: ChannelId;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  date: string;                                    // YYYY-MM-DD theo `publish.timezone` của kênh
  generated_at: Iso8601;                           // lần lập/sửa gần nhất
  capacity: {
    videos: number;                                // số video khả thi của kênh hôm nay (050)
    limiting_factor: 'time' | 'tokens' | 'uploads' | 'cap';
    reasons: string[];                             // tiếng Việt (từ mô hình năng lực)
  };
  notes?: string[];                                // tiếng Việt: vì sao lập ít/không lập video (không đủ ứng viên, tạm dừng…)
  items: PlanItem[];
}
type PublishStatus = 'pending' | 'uploading' | 'scheduled' | 'private' | 'public' | 'cancelled' | 'failed';
interface PlatformPublish {
  status: PublishStatus;
  video_id?: string;                               // ID video trên nền tảng (không phải VideoId của StudioFlow)
  url?: string;
  publish_at?: Iso8601;                            // giờ công khai đã đặt trên nền tảng (chỉ khi nền tảng tự công khai theo lịch)
  veto_until?: Iso8601;                            // hết giờ này mà không bị phản đối → làm theo lịch
  uploaded_at?: Iso8601;
  attempts?: number;                               // số lần tải lên đã thử (tối đa 3)
  error?: string;                                  // tiếng Việt: vì sao chưa đăng / lỗi
  note?: string;
}
interface PublishState { youtube?: PlatformPublish; tiktok?: PlatformPublish; facebook?: PlatformPublish }
interface PlanItem {
  id: PlanItemId;
  status: PlanItemStatus;
  candidate_id: string;                            // `ResearchCandidate.id` (5.17); chủ đề do người dùng/agent thêm tay dùng `manual:<id>`
  title: string;                                   // tên làm việc của video
  angle: string;                                   // một dòng: vì sao / góc nhìn (tiếng Việt)
  source: { kind: 'competitor' | 'competitor_evergreen' | 'trending' | 'trend' | 'news'; url?: string;
            source_channel?: { id: string; title: string } };
  workflow_id: string;
  output_profile: string;
  publish_at: Iso8601 | null;                      // có offset múi giờ; null = kênh không có khung giờ
  platforms: string[];                             // `publish.platforms` của kênh
  /** @minimum 0 @maximum 100 */
  score: number;                                   // điểm ứng viên (5.17)
  reasons: string[];                               // tiếng Việt
  video_id?: VideoId;                              // điền khi 052 tạo video
  publish?: PublishState;                          // 053: trạng thái đăng từng nền tảng (chỉ mục `produced`)
  note?: string;                                   // ghi chú của người dùng / lý do bỏ qua hoặc lỗi
}
```

### 5.19 `autopilot/log/<YYYY-MM-DD>.jsonl` (052)
Nhật ký vận hành Autopilot của một kênh (FR-AP-07, NFR-11): **mỗi quyết định tự động một dòng JSON**, kèm lý do tiếng Việt — duyệt/đỗ điểm chốt, bỏ qua cảnh báo thời lượng, chạy lại bước, tạm dừng vì hết hạn mức Claude, đỗ/hỏng một mục. Ngày theo `publish.timezone` của kênh (ngày của kế hoạch). Chỉ nối thêm (`WriteStore.appendLine`), không sửa dòng cũ. Giao diện/agent đọc để giải thích "vì sao video này dừng".

```ts
interface AutopilotLogLine {
  ts: Iso8601;
  level: 'info' | 'warn' | 'error';
  /** Mã sự kiện, ví dụ plan.built, item.start, gate.decision, step.retry, step.waive, limit.hit, item.parked, item.failed, item.produced, paid.allowed, item.reclaimed (052). */
  event: string;
  item_id?: PlanItemId;
  video_id?: VideoId;
  step_id?: string;
  message: string;                                 // tiếng Việt: việc gì + vì sao
  data?: Record<string, unknown>;                  // chi tiết máy đọc được (điểm, ngưỡng, thời điểm hết hạn mức…)
}
```

### 5.20 `autopilot/reports/<YYYY-MM-DD>.json` (054)
Báo cáo ngày của một kênh Autopilot (FR-AP-11): số liệu hiệu quả (bảng `channel_metrics` / `video_metrics` trong `studioflow.db`, D11 3.1), sản xuất và đăng bài hôm nay (kế hoạch 5.18), chi phí Claude so với ngân sách, quota YouTube, tiêu đề kế hoạch ngày mai. Là nguồn cho tin nhắn Telegram và cho màn hình ứng dụng sau này. Ngày theo `publish.timezone`. Ghi một lần mỗi ngày vào giờ `report.time` (idempotent: có file `delivered_at` thì không gửi lại; có file chưa `delivered_at` → chỉ gửi lại); `/report` tạo bản mới không đánh dấu đã gửi.

```ts
interface DailyReport extends Versioned {
  channel_id: ChannelId;
  channel_name: string;
  /** @pattern ^\d{4}-\d{2}-\d{2}$ */
  date: string;                                    // ngày báo cáo theo `publish.timezone` của kênh
  generated_at: Iso8601;
  delivered_at?: Iso8601;                          // đã gửi vào Telegram
  youtube: {
    connected: boolean;
    /** Ngày dữ liệu mới nhất đã có (YouTube Analytics thường trễ 1–3 ngày). */
    metrics_day?: string;
    views?: number;
    views_prev?: number;                           // ngày liền trước
    views_avg7?: number;                           // trung bình 7 ngày trước `metrics_day`
    views_change_pct?: number;                     // so với ngày liền trước
    views_change_avg7_pct?: number;
    watch_minutes?: number;
    avg_view_duration_s?: number;
    subs_gained?: number; subs_lost?: number;
    likes?: number;
    top_videos: { title: string; url?: string; views: number; item_id?: string }[];   // 7 ngày gần nhất, video do app đăng
  };
  production: { produced: number; in_production: number; needs_review: number; failed: number; planned: number;
                items: { title: string; status: PlanItemStatus; note?: string }[] };
  publishing: { uploaded: { title: string; status: PublishStatus; url?: string; publish_at?: Iso8601 }[];
                waiting: { title: string; status: PublishStatus; note?: string }[] };   // pending / failed / private chờ công khai
  claude: { used_tokens: number; budget_tokens: number | null; used_pct: number | null };
  quota: { youtube_used: number; youtube_limit: number };
  tomorrow: string;                                // một dòng tiếng Việt
  notes: string[];                                 // tiếng Việt: thiếu dữ liệu, chưa kết nối, v.v.
}
```

### 5.21 `autopilot/learning.json` (057)
Vòng phản hồi (FR-AP-13): từ số liệu thật (bảng `video_metrics`, 054) của các video do app đăng và **đã đủ `min_age_days` (3) ngày**, tính hiệu quả tương đối của từng nhóm so với mức trung bình của kênh, theo năm chiều: dạng ứng viên (`kind`), chủ đề trụ cột (`pillar`), kênh đối thủ nguồn (`source`), workflow, khung giờ đăng (`slot`). Hiệu quả một video = lượt xem trung bình mỗi ngày trong 7 ngày đầu (tối đa 7, tối thiểu 3 ngày có số liệu); `ratio` của nhóm = trung vị hiệu quả nhóm / trung vị hiệu quả cả kênh. `multiplier` = 1 + clamp(`ratio` − 1, −0,3, +0,3) × n / (n + 5) — kéo về 1 khi ít mẫu, luôn trong [0,7; 1,3]; nhóm dưới 2 video không tạo hệ số. Dưới 5 video đủ tuổi trong 60 ngày → `enough_data: false` và **không ảnh hưởng gì**. Tính xác định (cùng dữ liệu → cùng kết quả), làm mới mỗi lần lập kế hoạch ngày, ghi qua WriteStore chỉ khi nội dung đổi. Áp dụng khi chọn chủ đề (051): chỉ **xếp hạng** (điểm gốc 0–100 trong nghiên cứu và `autopilot.min_score` không đổi); hệ số của ứng viên = tích các hệ số `kind`, `pillar`, `source` kẹp trong [0,7; 1,3]; mục kế hoạch ghi lý do tiếng Việt. Chiều `workflow` và `slot` được ghi để xem, chưa dùng khi chọn. Tắt bằng `autopilot.learning` = false.

```ts
interface ChannelLearning extends Versioned {
  channel_id: ChannelId;
  generated_at: Iso8601;
  enough_data: boolean;                            // false → mọi hệ số bằng 1, không ảnh hưởng
  /** Số video đủ tuổi có số liệu đã dùng. */
  videos: number;
  /** Trung vị lượt xem mỗi ngày của kênh (mẫu số của `ratio`). */
  baseline_daily_views: number;
  dimensions: {
    kind: LearningGroup[]; pillar: LearningGroup[]; source: LearningGroup[];
    workflow: LearningGroup[]; slot: LearningGroup[];
  };
  notes: string[];                                 // tiếng Việt: vì sao chưa đủ dữ liệu…
}
interface LearningGroup {
  key: string;                                     // `trending`, tên trụ cột, ID kênh nguồn, ID workflow, `HH:MM`
  label?: string;                                  // tên dễ đọc (kênh nguồn)
  n: number;                                       // số video trong nhóm
  /** Hiệu quả nhóm / hiệu quả kênh (1 = bằng trung bình). */
  ratio: number;
  /** @minimum 0.7 @maximum 1.3 */
  multiplier: number;
}
```

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
  managed_channels?: { path: string; added_at: Iso8601 }[];   // kênh app quản lý (047, Autopilot M6); mở kênh lần đầu → thêm
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
| `frame_build.model` | string (model Claude) | app, channel |
| `frame_build.model_simple` | string (model Claude, rỗng = tắt) | app, channel |
| `budget.tokens_per_video` | number | app, channel, video |
| `budget.api_cost_usd_per_video` | number | app, channel, video |
| `budget.cache_gb` | number | channel |
| `music.volume_db` | number | channel, video, scene |
| `music.duck_db` | number | channel, video |
| `asr.wer_threshold.<lang>` | number | app, channel |
| `asr.max_regen` | number | app, channel |
| `lipsync.enabled` | boolean | channel, video, frame |
| `workflow.autopilot` | boolean | app, channel, video |
| `workflow.key_approvals` | string[] (id bước) | app, channel, video |
| `policy.auto_approve.batch_gen` | boolean | video |
| `policy.auto_approve.paid_api` | boolean | video |
| `check.duration_tolerance` | number (tỉ lệ) | channel, video |
| `meta.title_max` / `meta.description_max` | number (ký tự) | channel, video |
| `meta.hashtags` | string[] | channel, video |
| `policy.batch.tts_lines` / `policy.batch.images` | number | app |
| `policy.paid_api.per_call_usd` | number | app |
| `policy.budget_warn_ratio` | number (tỉ lệ) | app |
| `gpu.vram_budget_gb.<engine>` / `gpu.vram_total_gb` | number | app |
| `autopilot.enabled` | boolean | channel |
| `autopilot.paused` | boolean | app |
| `autopilot.background` | boolean | app |
| `trash.retention_days` | number | app, channel |
| `autopilot.asr_accept_ratio` | number | app, channel |
| `autopilot.competitors` | string[] (ID kênh YouTube `UC…`) | channel |
| `autopilot.pillars` | string[] | channel |
| `autopilot.workflows` | string[] (id workflow) | channel |
| `autopilot.max_per_day` | number | channel |
| `autopilot.min_score` | number (0–100, điểm tối thiểu của chủ đề được lập vào kế hoạch ngày, 051) | channel |
| `autopilot.duration_waive_ratio` | number (tỉ lệ 0–1: lệch thời lượng so với mục tiêu mà Autopilot tự bỏ qua cảnh báo `audio_duration`, 052) | app, channel |
| `autopilot.work_window` | string (`HH:MM-HH:MM`) | app |
| `autopilot.budget_share` | number (tỉ lệ) | app |
| `autopilot.daily_tokens` | number (token Claude mỗi ngày; null = tự học, 050) | app |
| `autopilot.learning` | boolean (dùng hiệu quả thật của video đã đăng để điều chỉnh thứ hạng chủ đề, 057) | app, channel |
| `report.enabled` | boolean (gửi báo cáo ngày vào nhóm Telegram, 054) | app |
| `report.time` | string (`HH:MM` theo `publish.timezone` của từng kênh; giờ gửi báo cáo ngày, 054) | app |
| `telegram.enabled` | boolean (bật bot Telegram: thông báo vận hành và hỏi đáp với agent `ops`, 055) | app |
| `telegram.chat_id` | string (ID nhóm/kênh Telegram nhận thông báo; rỗng = chưa đặt) | app |
| `telegram.allowed_user_ids` | string[] (ID người dùng Telegram được ra lệnh cho bot; rỗng = mọi thành viên của `telegram.chat_id`) | app |
| `publish.youtube.audited` | boolean (dự án API YouTube đã qua kiểm duyệt của Google: được đăng công khai/hẹn giờ; false = chỉ tải lên riêng tư, người dùng tự công khai trong YouTube Studio, 053) | app |
| `publish.tiktok.audited` | boolean (ứng dụng TikTok đã qua kiểm duyệt Content Posting API: được đăng công khai; false = mọi bài đăng `SELF_ONLY`, người dùng tự công khai trong app TikTok, 056) | app |
| `publish.facebook.page_id` | string (ID Trang Facebook nhận Reels; không phải bí mật, 056) | channel |
| `publish.youtube.channel_id` | string (ID kênh YouTube `UC…` gắn với kênh StudioFlow, ghi khi kết nối OAuth; không phải bí mật) | channel |
| `publish.platforms` | string[] (`youtube`, `tiktok`, `facebook`) | channel |
| `publish.slots` | string[] (`HH:MM` hoặc `<thứ> HH:MM`, thứ: mon…sun) | channel |
| `publish.timezone` | string (IANA) | app, channel |
| `publish.veto_hours` | number | app, channel |

`workflow.autopilot` là **"Tự duyệt bước"** (034: engine tự duyệt các điểm duyệt trong một video, trừ điểm chốt `workflow.key_approvals`). `autopilot.*` là chế độ **Autopilot** theo kênh (M6, 047): kênh bật `autopilot.enabled` thì "Tự duyệt bước" luôn bật cho video của kênh.

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
