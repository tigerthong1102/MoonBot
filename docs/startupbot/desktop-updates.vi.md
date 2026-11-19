# Cập nhật StartupBot trên máy tính

Bản cài có chữ ký và có kênh cập nhật sẽ kiểm tra sau khi mở 15 giây, rồi mỗi giờ. Khi có phiên bản mới hơn, StartupBot tải trong nền và cài khi bạn thoát ứng dụng như bình thường. Trên Mac, đóng cửa sổ vẫn có thể giữ ứng dụng chạy. Bạn cũng có thể chọn khởi động lại khi công việc đã xong. Workspace tiếp tục dùng thư mục dữ liệu StartupBot hiện tại.

Người đang dùng bản nội bộ 1.0.0 có updater tắt cần cài thủ công bản có chữ ký đầu tiên. Giữ nguyên thư mục dữ liệu khi thay ứng dụng. iOS và Android dùng cơ chế phân phối hiện tại.

## Chuẩn bị một phiên bản cho desktop

1. Trên máy ký Mac Apple Silicon, dùng `bash scripts/customer-mac.sh build`. Trên máy ký Windows x64, dùng `scripts/customer-windows.ps1 build -Thumbprint <dấu-vân-tay-chứng-chỉ>`. Dùng chứng chỉ Developer ID Application và profile notary trên Mac, hoặc chứng chỉ Authenticode có khóa riêng trên Windows.
2. Bộ đóng gói tạo ZIP trên Mac hoặc NSIS EXE trên Windows, cùng manifest `stable-arm64-mac.yml` hoặc `stable-x64.yml` trong thư mục build. Script kiểm tra SHA-512, kích thước và tên của payload. Manifest dùng số phiên bản chung của StartupBot.
3. Trước khi phân phối, cài bản có chữ ký trước đó trong hồ sơ thử, nâng lên bản mới, mở lại và kiểm tra phiên bản cùng dữ liệu. Trên Windows, dùng cùng danh tính nhà phát hành. Trên Mac, kiểm tra chữ ký cùng Team ID và kết quả công chứng.
4. Khi chủ dự án phê duyệt phát hành, đính kèm từng manifest và đúng ZIP/EXE mà nó nêu vào cùng một GitHub Release của `tigerthong1102/MoonBot`. Chỉ đặt làm bản Latest sau khi tất cả tệp cần cho các kênh đang phục vụ đã có và đã được kiểm tra từ máy khách. DMG phục vụ cài lần đầu. Build chỉ chạy `--publish never`.
