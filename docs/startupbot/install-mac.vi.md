# Cài StartupBot trên Mac Apple Silicon

1. Trong menu Apple → Giới thiệu về máy Mac này, kiểm tra mục Chip. Bản arm64 dành cho máy có chip Apple M.
2. Mở tệp StartupBot DMG nhận từ người phụ trách triển khai. Kéo StartupBot vào Applications.
3. Tháo ổ đĩa StartupBot trong Finder rồi mở StartupBot từ Applications. Khi macOS hỏi có mở ứng dụng vừa tải về hay không, kiểm tra tên ứng dụng và nhà phát triển trước khi mở.
4. Trong phần Engines, chọn nhà cung cấp AI bạn đang sử dụng hoặc Ollama nếu máy đã cài model cục bộ. Tạo bot, chọn model và gửi một tin nhắn để kiểm tra.
5. Để đối chiếu hai tệp CSV/XLSX, mở Data → Đối chiếu chứng từ. Chọn công ty, kỳ và các cột cần so. Công cụ này tính trên máy.

Nếu macOS báo không xác minh được nhà phát triển, dừng ở thông báo đó và liên hệ người gửi bộ cài. Khi báo lỗi, gửi phiên bản macOS, loại chip và nội dung thông báo đã che thông tin riêng. Khi nâng cấp, thoát ứng dụng và sao lưu workspace qua Settings → Import & export trước khi thay bản cũ.

Nếu cần kết nối điện thoại Android qua USB, cài [Android SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools) từ Google, đưa thư mục chứa adb vào PATH rồi mở lại StartupBot. Các chức năng desktop khác dùng được khi chưa cài adb.
