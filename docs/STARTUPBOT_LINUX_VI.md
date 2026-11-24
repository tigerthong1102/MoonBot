# StartupBot cho Ubuntu Desktop

Bản thử nghiệm dành cho Ubuntu Desktop 24.04 trên máy Intel hoặc AMD 64-bit. Trong Terminal, lệnh `uname -m` phải trả về `x86_64`. Giải nén gói tải rồi mở Terminal tại thư mục vừa giải nén.

1. Kiểm tra bộ cài bằng `sha256sum -c SHA256SUMS-ubuntu-x64.txt`. Cả hai tệp phải hiện `OK`.
2. Cài gói Debian bằng `sudo apt install ./StartupBot-*-amd64.deb`. APT sẽ cài các thư viện cần thiết.
3. Mở **StartupBot** từ danh sách ứng dụng. Trong Cài đặt, chọn tiếng Việt nếu cần, kết nối nhà cung cấp AI của bạn rồi gửi tin nhắn đầu tiên.

Để dùng bản AppImage, cấp quyền bằng `chmod +x StartupBot-*-x86_64.AppImage` rồi chạy `./StartupBot-*-x86_64.AppImage`. Trên Ubuntu có hạn chế sandbox, ưu tiên gói Debian vì gói này cài kèm chính sách AppArmor cho trình duyệt.

Tính năng điều khiển máy tính cần phiên desktop X11. Trong phiên Wayland, StartupBot chặn thao tác điều khiển chưa được hỗ trợ. Với bản thử nghiệm này, để nâng cấp, tải bộ cài StartupBot mới và cài lại cùng định dạng. Khi gỡ gói Debian bằng `sudo apt remove startupbot`, APT quản lý các tệp ứng dụng, còn dữ liệu cá nhân nằm trong thư mục người dùng.
