# FN-028 — Báo cáo chi phí, Phoenix, so sánh model

> **Ghi chú tính năng — không ràng buộc.** Đầu vào gợi ý cho `/specify` và `/plan` của tính năng 028. Hợp đồng ràng buộc ở D11; khi tính năng được đặc tả, `specs/028-*/spec.md` thay thế file này.

**Phủ:** FR-OB-03/04, FR-CH-04, AC-M3-04

- **UI-12 Báo cáo chi phí:** theo video → bước → loại (LLM, API ảnh, GPU); token vào/ra, chi phí, thời gian GPU; so ngân sách; xuất CSV.
- **UI-08 Trace:** danh sách lần chạy (bước/phiên) → cây span, thời gian, token, chi phí; nút "Mở trong Phoenix" khi bật.
- **`sf eval compare --channel <id> --by producer_model|rubric_version --since <date>`:** bảng tỉ lệ duyệt không sửa lớn (diff < 10% số từ), điểm critic trung bình, số vòng trung bình, token/video.
- **Chọn ngữ cảnh từ xem trước (FR-CH-04):** Alt+click phần tử/frame hoặc "Đính kèm mốc hiện tại" (FN-008).
