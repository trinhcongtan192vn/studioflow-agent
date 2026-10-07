# 057 — Ghi chú nghiên cứu

- **Thước đo**: lượt xem/ngày trong 7 ngày đầu — công bằng giữa video cũ/mới hơn lượt xem lũy kế; cần ≥ 3 ngày vì YouTube trễ 1–3 ngày. Không tính 0 cho video riêng tư chưa công khai (ngày đầu có lượt xem mới là ngày công khai thật) — quan trọng vì dự án API chưa kiểm duyệt (053) khiến video ở riêng tư tới khi người dùng công khai tay.
- **Co về 1 (shrinkage)**: `n/(n+5)` — Bayes kinh nghiệm đơn giản, 5 mẫu = nửa tin; chặn ±30% để học sai không phá hẳn xếp hạng.
- **Chỉ đổi thứ hạng**: tránh vòng lặp tự củng cố hạ chuẩn (`min_score` giữ nguyên điểm gốc); `item.score` giữ điểm nghiên cứu để người dùng thấy gốc.
- **Trung vị** thay trung bình: ổn định với video đột biến.
- **Xác định**: không ngẫu nhiên, sắp xếp theo hệ số rồi khóa; thứ tự đầu vào không ảnh hưởng (có test).
- **Lệch gợi ý**: `docs/feature-notes/` không có ghi chú 057.
