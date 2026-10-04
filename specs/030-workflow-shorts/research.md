# Research — 030

## R1. Kiểm vùng an toàn
`hyperframes check` không có tùy chọn vùng an toàn theo lề (`--frame-check` chỉ bắt media ra ngoài khung, `--caption-zone` là dải caption). Cách làm: bản chụp chỉ đọc (017) + `hyperframes preview` bản ghim, mở `/api/projects/<id>/preview` trong Chrome headless của HyperFrames (`hyperframes browser path`) bằng `puppeteer-core@25.12.0` (cùng bản HyperFrames dùng, thêm làm phụ thuộc trực tiếp), chờ `window.__playerReady`, `__player.seek(t)` giữa mỗi frame, đo hộp từng đoạn chữ đang hiện (Range), so vùng an toàn (dung sai 2 px). Chạy ở gate `finalize` (~10 s).

## R2. Vùng an toàn dọc
`top 8%, right 12%, bottom 20%, left 6%` — chừa nút tương tác bên phải và tiêu đề/kênh ở dưới của YouTube Shorts. Caption karaoke đặt ở 58% chiều cao (trong vùng an toàn).

## R3. `read_only_videos` cho phiên đang mở
Phiên `main` mở từ pha briefing, trước khi engine biết video nguồn → Gateway cho phép đọc video có trong `state.json.read_only_videos` của video phiên (đọc lúc gọi), ngoài `SessionContext.read_only_videos`.

## R4. Dùng lại audio
Khóa cache TTS gồm chữ + giọng + tham số → line giữ nguyên văn (cùng giọng kênh) trúng cache, không sinh lại. Prompt script bỏ ID line/beat của nguồn để producer không chép ID.

## R5. Ngoài phạm vi lần này
- "Bắt nhịp: cắt frame theo phách nếu có BPM" (FN-030 mục 3) — chưa làm (FN không ràng buộc); frame dọc theo lời đọc.
- Blueprint `big-text`, `stat-pop`, `split-reveal` → mô tả trong skill (như 029 R3).
