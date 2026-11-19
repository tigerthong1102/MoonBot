# Cài StartupBot trên Windows x64

1. Tải bộ cài StartupBot Setup từ đầu mối triển khai. Trong Properties → Digital Signatures, kiểm tra chữ ký hợp lệ và tên đơn vị phát hành trùng với thông tin người gửi cung cấp.
2. Mở EXE và làm theo hướng dẫn. Ứng dụng cài cho tài khoản Windows hiện tại. Sau khi cài, mở StartupBot từ Start.
3. Trong Engines, chọn nhà cung cấp AI hoặc Ollama nếu máy đã cài model cục bộ, rồi tạo bot để bắt đầu. Đối chiếu CSV/XLSX có ở Data → Đối chiếu chứng từ.
4. Khi nâng cấp, dùng Settings → Import & export để sao lưu trước khi chạy bộ cài mới.

Nếu Windows báo Unknown publisher hoặc chữ ký không hợp lệ, gửi phiên bản Windows và thông báo đã che dữ liệu riêng cho đầu mối triển khai.

Nếu cần kết nối điện thoại Android qua USB, cài [Android SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools) từ Google, đưa thư mục chứa adb vào PATH rồi mở lại StartupBot. Các chức năng desktop khác dùng được khi chưa cài adb.
