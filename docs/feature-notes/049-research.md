# FN-049 — Quét nghiên cứu Autopilot: nguồn, tín hiệu, hằng số chấm điểm

Gợi ý, không ràng buộc (CLAUDE.md mục 6). Hợp đồng file: D3 mục 5.17; tool: D4 mục 2.4, 9.5; chính sách: D5 mục 4. Hằng số dưới đây nằm trong `packages/core/src/research/score.ts` (`RESEARCH_CONSTANTS`), không phải khóa cấu hình — chỉnh khi đã có số liệu thật (FR-AP-13, 057).

## Nguồn mỗi lần quét

| Nguồn | Cách lấy | Quota |
|---|---|---|
| Đối thủ (`autopilot.competitors`) | `channels.list part=snippet,contentDetails` → playlist uploads; `playlistItems.list` 2 trang (≤ 100 video mới nhất); `videos.list part=snippet,statistics,contentDetails` theo lô 50 | ~5 đơn vị / đối thủ |
| Video đã làm của kênh | `videos/*/publish.md` (`title`) và `BRIEF.md` (`title_working`) | — |
| Trending | `videos.list chart=mostPopular regionCode=<VN/DE/US> maxResults=50` | 1 đơn vị |
| Google Trends | RSS `trends.google.com/trending/rss?geo=<VN/DE/US>` | — |
| Tin nóng | RSS Google News search mỗi chủ đề trụ cột (tối đa 5 chủ đề, 10 tin/chủ đề, tin ≤ 7 ngày) | — |

Vùng theo ngôn ngữ kênh: `vi`→VN, `de`→DE, `en`→US. Không dùng `search.list` (100 đơn vị/lần).

## Ứng viên
- **competitor**: video đối thủ đăng ≤ 14 ngày.
- **competitor_evergreen**: video đối thủ đăng ≥ 30 ngày và gấp ≥ 2× lượt xem trung vị của kênh đó (video nổi bật cũ, chủ đề "bền").
- **trending / trend / news**: chỉ giữ khi khớp một chủ đề trụ cột (tỉ lệ khớp ≥ 0,5); kênh chưa khai chủ đề trụ cột → giữ tất cả, không có điểm khớp.
- Trùng ID (cùng video vừa của đối thủ vừa trending) → giữ bản điểm cao hơn. Giữ tối đa 50 ứng viên, điểm cao trước.

## Tín hiệu (tổng tối đa 100)

| Tín hiệu | Điểm | Công thức |
|---|---|---|
| Hiệu quả — đối thủ | 0–40 | tỉ lệ vượt trội `r` = lượt xem ÷ trung vị lượt xem của kênh đó; điểm = 40 × clamp((log2 r + 1) / 4): 0,5× → 0, 8× → 40. Trung vị lấy trên video ≥ 7 ngày tuổi (khi có ≥ 3 video như vậy, nếu không thì mọi video). Video < 7 ngày so với trung vị × (tuổi / 7 ngày), sàn 0,1 — lượt xem còn đang tăng. |
| Hiệu quả — trending | 0–40 | tốc độ `v` = lượt xem / giờ từ lúc đăng; 40 × clamp((log10 v − 2) / 3): 100/giờ → 0, 100 000/giờ → 40 |
| Hiệu quả — Google Trends | 0–40 | lượt tìm ước tính `t` (`ht:approx_traffic`, "200K+" → 200 000); 40 × clamp((log10 t − 3) / 3): 1 000 → 0, 1 000 000 → 40 |
| Hiệu quả — tin | 15 | cố định (RSS không có số đo) |
| Độ mới | 0–20 | 20 × clamp(1 − tuổi / 30 ngày); evergreen cố định 10; không có ngày đăng → 10 |
| Khớp chủ đề trụ cột | 0–30 | tỉ lệ từ của chủ đề có trong tiêu đề (+ thẻ video / tiêu đề tin kèm theo), lấy chủ đề khớp nhất; 30 × tỉ lệ. Tin tìm theo chủ đề: sàn 0,5 cho chính chủ đề đó. |
| Độ mới so với kênh | 0–10 | `s` = Jaccard lớn nhất giữa từ của tiêu đề và từ của tiêu đề video đã làm; 10 × clamp(1 − s / 0,6) |
| Gần trùng | −30 | khi `s` ≥ 0,6 |

Điểm cuối = làm tròn, kẹp 0–100. Mỗi tín hiệu sinh một câu lý do tiếng Việt trong `reasons[]`.

## So khớp chữ
- Gập dấu: NFD bỏ dấu kết hợp, `đ`→`d`, `ß`→`ss`, chữ thường; tách theo ký tự không phải chữ/số; bỏ từ ≤ 1 ký tự và từ dừng ngắn vi/de/en (`và`, `của`, `der`, `und`, `the`, `how`…).
- Tiếng Việt so theo âm tiết (từ "lịch sử" → `lich`, `su`), đủ cho tiêu đề ngắn; không tách từ ghép.

## Lỗi nguồn
Mỗi nguồn chạy độc lập; lỗi ghi `sources.*.error = {code, message}`, lần quét vẫn ghi file. Thiếu khóa YouTube → đối thủ + trending lỗi `E_PROVIDER_UNAVAILABLE`, RSS vẫn chạy.
