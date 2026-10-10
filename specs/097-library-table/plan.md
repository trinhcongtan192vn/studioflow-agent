# Kế hoạch 097

Tái dùng render.library và LibraryEntry; thay trình bày LibraryPage bằng table + pagination phía renderer. Hàm thuần library-view xử lý lọc/sort/phân trang trình bày; nghiệp vụ lưu/xuất video vẫn ở core hiện hữu. Không đổi IPC/schema/artifact, không cần migration hoặc CLI mới.

Gate I–X đạt: docs trước code, test fail trước (lọc/phân trang và Electron), Gateway không thay đổi; không sinh nội dung mới nên không thêm provenance; không thêm project/adapter. Kiểm UI trên dữ liệu render mẫu, không gọi LLM/GPU.
