# FN-026 — Bảng caption: tương tác

> **Ghi chú tính năng — không ràng buộc.** Đầu vào gợi ý cho `/specify` và `/plan` của tính năng 026. Hợp đồng ràng buộc ở D9 mục 6; khi tính năng được đặc tả, `specs/026-*/spec.md` thay thế file này.

**Spike:** S6 (f) · **Phủ:** FR-ST-05, AC-M3-03

- Vị trí: dưới khung Xem trước (UI-11); có trình phát audio bản trộn giọng, dạng sóng (đỉnh mỗi 10 ms), chữ caption chạy theo.
- Kéo mép trái/phải cụm: bước 10 ms, bám mốc từ ±40 ms; không chồng lên cụm kề (tự đẩy hoặc chặn).
- Tách cụm tại một từ; gộp hai cụm kề cùng line.
- Sửa chữ cụm chỉ đổi chữ hiển thị; muốn đổi lời đọc thì sửa qua chat.
- Phím: Space phát/dừng, ←/→ nhảy cụm, Ctrl+Z/Ctrl+Y.
- Tự lưu sau 1 giây không thao tác; xung đột `base_hash` → tải lại và báo.
- Đồng bộ đầu phát với Studio qua `postMessage` nếu S6 (f) cho phép; không thì chạy độc lập.
