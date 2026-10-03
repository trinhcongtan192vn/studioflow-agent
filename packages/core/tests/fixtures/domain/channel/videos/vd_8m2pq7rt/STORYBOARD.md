---
schema_version: 1
video_id: vd_8m2pq7rt
status: draft
---
## Scene 1 — Kinh thành Thăng Long
```sf-scene
id: sc_p0q2m5ka
title: Kinh thành Thăng Long
mood: trang nghiêm
look: warm-archive
music: { query: "trang nghiêm, chậm, đàn tranh", volume_db: -18 }
config: { look.id: scene-look }
```

### Frame 1
```sf-frame
id: fr_9x2b7cqe
beat_ids: [bt_4nd8w1zc]
line_ids: [ln_2r7c4kxm, ln_9w3b6tqa]
blueprint: title-over-map
intent: "Bản đồ Đại Việt hiện dần, chữ năm 1428 trượt vào"
layers:
  - { id: el_t5w8n3ja, kind: background, asset_request: { source: generate, prompt: "bản đồ cổ Đại Việt, giấy dó", aspect: "16:9" } }
  - { id: el_q2k7m4zp, kind: text, text: "1428" }
transition_in: { type: crossfade, duration_ms: 600 }
config: { look.id: frame-look }
```
Ghi chú văn xuôi tùy ý.

### Frame 2
```sf-frame
id: fr_3m8k1w7d
beat_ids: [bt_7c1v5p0e]
line_ids: [ln_5h8q2m3x]
intent: "Cung điện lúc hoàng hôn"
layers:
  - { id: el_a1b2c3d4, kind: image, asset_id: as_h6k2q9vt }
```
