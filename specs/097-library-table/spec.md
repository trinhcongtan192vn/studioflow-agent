# 097 — Thư viện video dạng bảng có phân trang

Yêu cầu Tan 10/10/2026, tham chiếu ảnh YouTube Studio. Dựa trên D10 mục 2 (097), 073 và hợp đồng render.library.

- FR-LIB-97-01 / AC-01: thay lưới thẻ bằng bảng ngang: thumbnail có thời lượng, tiêu đề, bản render, định dạng, ngày hoàn tất và thao tác; giữ phát video/xuất/mở thư mục/mở video.
- FR-LIB-97-02 / AC-02: tìm theo tiêu đề/ID không phân biệt dấu tiếng Việt, tab Tất cả/Video/Shorts, lọc Tất cả/Phát hành/Nháp, đổi thứ tự ngày mới/cũ. Chỉ hiện dữ liệu app có.
- FR-LIB-97-03 / AC-03: 10/25/50 dòng mỗi trang; hiện khoảng đang xem/tổng số và trang hiện tại; đầu/trước/sau/cuối vô hiệu ở biên. Đổi tìm kiếm/lọc/cỡ trang/kênh reset trang; dữ liệu giảm không gây trang rỗng giả.
- FR-LIB-97-04 / AC-04: tải/rỗng/không khớp tìm kiếm/lỗi được phân biệt; tải lại khi lỗi; bảng cuộn ngang trong khung hẹp, điều khiển có nhãn trợ năng.

Mỗi dòng là một bản render (giữ ngữ nghĩa Thư viện hiện hữu); không thêm kết nối YouTube hay analytics vào nhiệm vụ này.
