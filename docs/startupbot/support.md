# Hỗ trợ StartupBot Desktop

Trong đợt sử dụng nội bộ, liên hệ riêng với người đã bàn giao bộ cài StartupBot cho bạn. Ghi phiên bản trong mục About, hệ điều hành, kiến trúc máy, tính năng, việc bạn đã làm và kết quả mong đợi. Nếu có thể, kèm các bước tái hiện bằng dữ liệu tự tạo và ảnh màn hình đã che thông tin cá nhân. Giữ lại bản gốc trên máy.

| Khi gặp sự cố | Cách xử lý |
| --- | --- |
| macOS chặn bản tải về | Kiểm tra nguồn cung cấp và SHA-256 của DMG. Liên hệ người cấp bộ cài để nhận bản có chữ ký Developer ID và notarization phù hợp. |
| Mở được app nhưng khóa đã lưu chưa dùng được | Mở khóa Keychain của tài khoản rồi thoát và mở lại StartupBot. Thao tác reset saved keys cần người dùng xác nhận. |
| Điện thoại mở nhầm ứng dụng hoặc không tìm thấy máy tính | Trên cùng Wi-Fi tin cậy, mở mục ghép nối trong StartupBot trên máy tính và tạo mã QR mới. Nếu nhập thủ công, dùng cả địa chỉ và cổng mà StartupBot hiển thị. |
| Model chưa trả lời hoặc báo hết quota | Kiểm tra engine đã chọn. Với Ollama, kiểm tra dịch vụ và model trên máy. Với nhà cung cấp trả phí, kiểm tra hạn mức trong tài khoản của bạn. Chỉ gửi mã lỗi và tên model. |
| Số tiền sai | Dùng Data → Đối chiếu chứng từ với tệp nghiệp vụ và báo cáo đối chứng cùng công ty, kỳ. Giữ báo cáo HTML để người có quyền kiểm tra. |
| Nghi mất dữ liệu | Giữ nguyên workspace hiện tại và bản sao lưu. Trước khi nhập bản sao, kiểm tra preview và vị trí đích. REPLACE thay thế workspace đích. |
| Nghi lộ dữ liệu hoặc thao tác ngoài ý muốn | Dừng tác vụ, thu hồi quyền của bot và khóa liên quan ở nhà cung cấp. Liên hệ riêng với đầu mối đã giao ứng dụng. |

Đầu mối tiếp nhận ghi nhận phiên bản bị ảnh hưởng và tác động, tái hiện trên workspace cô lập, xác nhận cách khắc phục và cung cấp bản sửa kèm phiên bản, checksum và kết quả kiểm thử. Chỉ đóng sự cố sau khi người báo xác nhận kết quả hoặc hai bên thống nhất cách kiểm chứng. Số lần cần trợ giúp, thời gian xử lý và chi phí theo người dùng phải được đo trong quá trình sử dụng có đồng ý. Hiện chưa công bố SLA hỗ trợ.

Chỉ trao đổi thông tin tối thiểu để tái hiện. File chứng từ, ảnh màn hình chưa che, toàn bộ log, mật khẩu backup và token có thể chứa dữ liệu riêng tư. Dùng ví dụ đã thay toàn bộ dữ liệu nhận dạng.
