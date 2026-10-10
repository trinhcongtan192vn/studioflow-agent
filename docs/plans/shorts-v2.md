# Kế hoạch: luồng dựng video mới (`shorts-v2`)

Trạng thái: **đã duyệt** (Tan, 2026-10-10) · đang làm bước 1

## 1. Vì sao làm lại

Video `vd_zchut8pg` (Nuvora, shorts, bật hết tùy chọn nâng cao) cho thấy:

- **Không có ảnh.** Storyboard Shorts chỉ có kiểu frame chữ (`big-text`, `stat-pop`, `split-reveal`). Bước Hình ảnh chỉ lấp layer storyboard đã xin, nên xong trong 0 giây. Luật chung xếp "vẽ bằng code" trước "sinh ảnh"; hướng dẫn explainer viết trước khi có Qwen (016 < 018) và chưa sửa.
- **Nhạc không nghe được.** Bed nhạc trung bình −54,6 dB so với giọng −22 dB: chuẩn hóa −24 LUFS, rồi `volume_db` −18, rồi duck −12.
- **Quá nhiều luật và điểm kiểm.**
  - AI viết HTML từng frame, khoảng 15 gate bắt lỗi của chính AI.
  - 17/17 frame trượt ở lượt Haiku vì lỗi định dạng máy móc, nên phải dựng lại bằng Sonnet. Tổng cộng 35 phiên agent cho một short 70 s.
  - Đường lùi khi lỗi (frame mẫu, co chữ) đều làm hình nghèo đi.
- **Token:** 95k–300k token Claude mỗi video; dựng frame chiếm 50–78%.

## 2. Nguyên tắc

1. **AI chỉ làm phần sáng tạo, một lượt cho cả video:** viết kịch bản, rồi đạo diễn.
2. **Hình dựng bằng code từ bộ layout.** Vùng an toàn, tương phản, chữ không đè được bảo đảm ngay khi dựng, không phải đi kiểm.
3. **Mặc định có ảnh:** sinh bằng Qwen local, dùng lại ảnh thư viện kênh.
4. **Kiểm ít, ở cuối, tự sửa.** Chỉ dừng hỏi người dùng khi không tự sửa được.
5. **Làm song song** với workflow hiện tại, so sánh A/B rồi mới thay.

## 3. Luồng 6 bước

| # | Bước (id) | Làm bằng | Đầu ra | Duyệt |
|---|---|---|---|---|
| 1 | `script` | 1 lượt `text.generate` (producer theo cài đặt) | `SCRIPT.md` | **có** (video làm tay) |
| 2 | `voice` | TTS + ASR (giữ nguyên) | audio từng line, thời lượng thật | — |
| 3 | `direct` | **1 lượt LLM, luôn Opus** (Tan chốt), trả JSON | `STORYBOARD.md` (app chuyển JSON → markdown, tất định) | — |
| 4 | `media` | code, song song | ảnh (`public/`), nhạc chọn theo tâm trạng | — |
| 5 | `compose` | code (bộ layout) | `compositions/frames/*.html`, `captions.html`, `index.html`, bed nhạc | — |
| 6 | `review` → `meta` → `render` → `publish` | code + 1 lượt LLM cho meta | MP4, tiêu đề/mô tả | **duyệt bản xem trước** |

Bỏ khỏi luồng mới: `storyboard` (agent), `assets` (agent), `finish` (look/effects/overlays agent), `music` (agent), `frames` (phiên frame mỗi frame), `finalize` (gate riêng). Studio, chỉnh caption, rerun từng bước, publish, Autopilot giữ nguyên.

## 4. Bước `direct`: một lượt, ra danh sách cảnh

**Đầu vào:** `BRIEF.md`, `SCRIPT.md` (line + thời lượng thật từ `audio_meta.json`), `frame.md` (màu, font kênh), danh mục layout + chuyển động (id + mô tả 1 dòng), danh sách ảnh thư viện kênh phù hợp (top 20 theo `asset.search`).

**Đầu ra (JSON, kiểm bằng schema; sai → sửa tất định hoặc 1 lần nhắc lại):**

```jsonc
{
  "music": { "mood": "energetic upbeat electronic", "energy": "high" },
  "images": [                       // ảnh dùng chung giữa các cảnh; số lượng do AI quyết theo kịch bản
    { "key": "rubber-hot-cold", "prompt": "…, vertical 9:16, cinematic", "reuse_asset": null },
    { "key": "lab", "reuse_asset": "as_xxxxxxxx" }
  ],
  "shots": [
    {
      "line_ids": ["ln_…"],         // mỗi line thuộc đúng 1 shot (app kiểm + tự gom)
      "layout": "image-title",      // id trong bộ layout
      "image": "rubber-hot-cold",   // key ở trên (layout cần ảnh)
      "text": { "main": "PULL IT.", "sub": null, "number": null },
      "motion": "ken-burns-in",     // chuyển động ảnh / chữ
      "transition": "cut",
      "accent": "UNDERSTOOD"        // từ được tô màu nhấn (tùy chọn)
    }
  ]
}
```

App tự làm, không cần luật trong prompt:
- gán ID;
- chia shot quá dài thành nhiều frame, mỗi frame 2–5 s, dùng lại ảnh với chuyển động khác;
- gom line thừa hoặc thiếu;
- cắt chữ dài (≤ 6 từ);
- đổi layout không tồn tại sang layout gần nhất.

Lỗi schema → sửa tất định (bỏ trường lạ, điền mặc định); chỉ nhắc model lại khi không đọc được JSON.

**Token ước tính:** vào 4–8k, ra 1,5–3k cho short 60 s.

## 5. Bước `media`

- **Ảnh:**
  - ưu tiên `reuse_asset`, sau đó sinh bằng `image.generate` (Qwen local, ~65 s/ảnh trên máy Tan);
  - **không giới hạn số ảnh** (Tan chốt): AI quyết theo kịch bản; ảnh có thể dùng chung cho nhiều cảnh, mỗi lần một chuyển động khác;
  - sinh song song với dựng frame chữ; thiếu ảnh (lỗi GPU) thì layout tự đổi sang bản không ảnh, không chặn bước;
  - ảnh sinh vào thư viện kênh kèm tag và prompt (dùng lại cho video sau).
- **Nhạc:** `music.find` theo `music.mood` + thời lượng (CLAP có sẵn). Không có thì bỏ nhạc, ghi chú trong tóm tắt.

## 6. Bước `compose`: bộ layout

Mở rộng `hf/templates.ts` (086/088 đã có `big-text`, `stat-pop`, `split-reveal`, `image-focus`, `list`, `fitFontSize`, `readable`, `contentBox`) thành **bộ layout** có ảnh. Mọi layout dùng chung:
- hộp nội dung theo vùng an toàn và dải caption của profile;
- chữ tự co (`fitFontSize`, đo theo bề rộng thật);
- màu chữ tự đạt tương phản với nền (`readable`); trên ảnh luôn có lớp tối (gradient) dưới chữ;
- `data-sf-id` đúng mẫu, timeline đăng ký sẵn, không `autoAlpha` trên clip. Toàn bộ lỗi định dạng hiện tại không thể xảy ra.

**Bộ đầu tiên (10 layout):**

| id | Mô tả |
|---|---|
| `image-title` | ảnh tràn khung + chữ lớn nửa trên |
| `image-caption` | ảnh tràn khung, chữ nhỏ góc (để ảnh nói) |
| `image-split` | hai ảnh trên/dưới (so sánh, nghịch lý) |
| `split-text` | hai nửa màu đối lập + chữ (không cần ảnh) |
| `stat-pop` | con số lớn bật lên + nhãn, nền ảnh mờ (nếu có) |
| `big-text` | chữ lớn trên nền màu (dự phòng khi không có ảnh) |
| `list` | 2–4 ý xuất hiện lần lượt |
| `quote` | trích dẫn + nguồn |
| `image-zoom-detail` | ảnh phóng vào một vùng + nhãn chỉ |
| `chart-bar` | biểu đồ cột đơn giản từ số trong `text` |

**Chuyển động (6):** `ken-burns-in`, `ken-burns-out`, `pan-left`, `pan-up`, `pop`, `slide-up`; chữ xuất hiện theo nhịp lời đọc (mốc từ ASR).

**Frame AI tùy chọn:** khi bật `advanced.custom_frames`, chỉ shot có `"hero": true` (tối đa 2 mỗi video, thường là hook) mới gọi phiên frame AI. Lỗi thì dùng layout, không vòng sửa.

## 7. Âm thanh

- Giọng ~−16 LUFS (theo `loudness_lufs` của profile).
- Nhạc khi không có lời ~−26 LUFS, khi có lời hạ ~8 dB: `music.volume_db` đổi nghĩa thành "mức nhạc so với giọng", mặc định −10; `music.duck_db` mặc định −8.
- Sửa luôn bug −54 dB cho workflow cũ.
- Kiểm cuối: đo bed thật. Nhạc dưới giọng quá 20 dB thì tự nâng gain.

## 8. Kiểm: còn 3, kiểm cuối, tự sửa

| Kiểm | Trượt thì |
|---|---|
| thời lượng ≤ trần profile | báo + gợi ý line cắt (không tự cắt lời) |
| `hyperframes lint/check` | sửa tất định (đã có 058, 093); vẫn lỗi thì frame đó dùng layout `big-text` |
| mức âm thanh (giọng, nhạc) | tự chỉnh gain |

Bỏ: rubric chấm kịch bản mặc định (giữ khi bật `advanced.refine`), `text_safe_area` (bảo đảm bởi layout; vẫn đo một lần ở cuối và tự co chữ như hôm nay), `assets_resolved`, `look/effects/overlays_valid`, `coverage` (app tự gom).

## 8b. Đầu ra đăng được ngay, không lỗi (yêu cầu bắt buộc)

**Phòng từ đầu, không phát hiện ở cuối.** Nền tảng đích (kênh: `publish.platforms`) quyết định giới hạn ngay từ bước 1:

- **Thời lượng mục tiêu** = min(trần profile, trần của mọi nền tảng đích). Kịch bản được viết để vừa; đo trên audio thật. Vượt thì báo ngay ở bước `voice`, không đợi tới lúc đăng.
- **Khung hình:** shorts luôn 9:16 1080×1920; explainer 16:9 chỉ đăng YouTube (Reels/TikTok đã chặn sẵn, 056).
- **Meta theo từng nền tảng:** tiêu đề, mô tả, hashtag cắt đúng giới hạn từng nơi (đã có: YouTube 100 ký tự / 5000 byte, TikTok caption, Facebook 2200). Sinh một lần, app cắt theo nền tảng.

**Kiểm `publish_ready` trước render phát hành** (tất định, tự sửa nếu được):

| Hạng mục | Kiểm | Tự sửa |
|---|---|---|
| Thời lượng | ≤ trần từng nền tảng đích (TikTok: lấy `max_video_post_duration_sec` từ API `creator_info` của tài khoản) | không (báo nền tảng nào không đăng được và vì sao) |
| Khung, fps | đúng profile (1080×1920, 30 fps) | — (dựng đúng từ đầu) |
| Mã hóa | H.264 + AAC 48 kHz, `yuv420p`, `+faststart`, dung lượng dưới giới hạn tải lên | render lại bằng tham số chuẩn |
| Âm lượng | ~−14 LUFS (`loudness_lufs` của profile), true peak ≤ −1 dBTP | chỉnh gain |
| Meta | đủ trường bắt buộc, độ dài theo nền tảng, có `#shorts` cho YouTube Shorts | cắt/điền |
| Ảnh đại diện | đúng kích thước/dung lượng YouTube | nén lại |

**Việc phải làm khi triển khai:** tra **tài liệu chính thức hiện hành** của YouTube Data API, TikTok Content Posting API và Facebook Reels API (thời lượng tối thiểu/tối đa, dung lượng, codec) rồi ghi thành hằng số có ngày tra trong `publish/limits.ts`. Không dùng số nhớ. Nếu Reels/TikTok có trần ngắn hơn 3 phút, Autopilot và trang chọn nền tảng phải biết trước để không lập video không đăng được.

Áp cho cả workflow cũ: kiểm `publish_ready` và tra giới hạn nền tảng làm ngay ở bước 1 của thứ tự làm, cùng bản sửa nhạc.

## 9. Điểm duyệt

- **Video làm tay: 2 điểm** (Tan chốt): duyệt kịch bản (trước khi tốn giọng đọc/ảnh) và duyệt bản xem trước (trước render phát hành).
- Autopilot: tự duyệt như hiện tại.

## 10. Kết quả kỳ vọng

| | Hiện tại (vd_zchut8pg) | `shorts-v2` |
|---|---|---|
| Token Claude | ~95k–300k | ~10–15k |
| Phiên agent | ~35 | 0 (chỉ lượt `text.generate`) + chat khi người dùng hỏi |
| Ảnh | 0 | mỗi cảnh có hình (số ảnh theo kịch bản, ~65 s GPU/ảnh) |
| Thời gian máy (short 60 s) | ~30 phút | phụ thuộc số ảnh (~65 s/ảnh, chạy song song với dựng) |
| Lỗi định dạng frame | thường xuyên | không thể (dựng bằng code) |

## 11. Thứ tự làm

1. **Sửa nhạc** (bug −54 dB, nghĩa mới của `volume_db`/`duck_db`) **+ kiểm `publish_ready`** (giới hạn nền tảng tra từ tài liệu chính thức, thời lượng mục tiêu theo nền tảng đích). Áp cho mọi workflow ngay.
2. **Bộ layout v1** (10 layout, 6 chuyển động, lớp tối dưới chữ, test hình chụp từng layout).
3. **Bước `direct`** (prompt, schema JSON, chuyển JSON thành `STORYBOARD.md`, sửa tất định).
4. **Bước `media`** (ảnh dùng chung, giới hạn, song song; nhạc theo tâm trạng).
5. **Workflow `shorts-v2`** (manifest 6 bước, 1 điểm duyệt, 3 kiểm cuối).
6. **A/B:** cùng 3 brief trên `shorts` và `shorts-v2`, so token, thời gian, số lỗi, Tan chấm hình (1–5), và **đăng thử thật** (riêng tư/nháp) lên mọi nền tảng đích: phải qua 100%.
7. Đạt thì `shorts-v2` thay `shorts`, Autopilot dùng bản mới; sau đó làm `explainer-v2` cùng khung (layout ngang 16:9).

## 12. Quyết định của Tan (2026-10-10)

- Số ảnh: không giới hạn, theo kịch bản AI tạo.
- Duyệt: kịch bản + bản xem trước (video làm tay); Autopilot tự duyệt.
- Model bước `direct`: luôn Opus.
- Đầu ra phải đăng được lên mọi nền tảng đích không lỗi (mục 8b).
