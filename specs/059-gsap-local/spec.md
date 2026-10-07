# 059 — GSAP cục bộ: check/render không phụ thuộc CDN

## Vấn đề
`hyperframes check`/render và bake look nạp GSAP từ `cdn.jsdelivr.net`; mạng chập chờn → "Navigation timeout", "gsap is not defined", "hyperframes render wrote 0/2 frames" → render phát hành hỏng ngẫu nhiên (nguy hiểm khi Autopilot chạy không người).

## Yêu cầu
- FR-CP-59-01: GSAP 3.14.2 (gói npm `gsap`, ghim chính xác, giấy phép "Standard no charge") được chép vào `videos/<vd>/public/vendor/gsap-3.14.2.min.js` (qua module ghi) khi lập project HyperFrames.
- FR-CP-59-02: `index.html` và `compositions/captions.html` nạp bản cục bộ; frame (do agent viết, hay do lớp hoàn thiện chèn overlay) được đổi URL CDN GSAP (jsDelivr/cdnjs/unpkg) → bản cục bộ ở bước dựng frame, lớp hoàn thiện (`frame_html`) và `finalize` (cùng chỗ sửa autoAlpha của 058).
- FR-CP-59-03: Bake look chép GSAP vào thư mục tạm.
- Phần băm của nút `index` gồm đường dẫn GSAP → project cũ lắp lại index một lần (rẻ, không gọi AI).
- Không đổi prompt frame worker (bản ghi LLM giữ nguyên); app tự đổi URL.

## AC
- `gsap-local.test.ts`: đổi URL 3 CDN, giữ URL khác; chép file đúng phiên bản; sửa frame một lần.
- E2E frame-build / render / narrated-explainer / finish xanh với GSAP cục bộ.
