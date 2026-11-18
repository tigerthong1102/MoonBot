# Kiểm kê cục bộ trong phòng thử nghiệm

Công cụ dành cho kỹ sư đánh giá Discovery Engine. Trong checkout tin cậy của một máy Windows thử nghiệm đã được phép kiểm kê, dùng Node 24 của môi trường phát triển.

```powershell
node scripts/business-connectors/inspect-local.ts --inspect-local
```

Đầu ra JSON nằm trên stdout cục bộ. Tên instance có thể chứa tên doanh nghiệp. Chỉ chia sẻ sau khi ẩn danh. Không đưa đầu ra nguyên bản vào hội thoại, ticket hay log chung. Mã thoát 0 là đã đọc được các nguồn đã định, 2 là một phần nguồn bị lỗi hoặc vượt giới hạn, 1 là từ chối hoặc không thu được bản kiểm kê hợp lệ. Máy trạm có thể dùng server khác ngay cả khi danh sách instance rỗng.

Collector dùng Windows PowerShell 5.1, registry HKLM/HKCU và Service Control Manager theo quyền người gọi. PowerShell phải được chính sách của máy cho phép chạy file đã kiểm tra. Thời hạn 30 giây, giới hạn stdout 512 KiB. Chỉ dùng tên dịch vụ, ánh xạ instance, phiên bản Setup, tên driver ODBC và các dấu vết ứng dụng trong danh sách cho phép. Phiên bản Setup có thể cũ hơn bản vá engine. Phiên bản ODBC 17/18 từ tên đăng ký chỉ là major. LocalDB chỉ có thể được ghi nhận ở mức runtime. Tên cài đặt ứng dụng là gợi ý, chưa liên kết với database. Tên instance ngoài tập ký tự được nhận diện làm giảm mức bao phủ.

Kết quả có `connection: "untested"` trong mọi trường hợp. Công cụ chưa được gắn vào MCP, Skills, menu hay bộ cài khách hàng. Không có hoạt động mạng, truy vấn SQL hoặc thay đổi cấu hình.

Chạy lại fixture đa nền tảng bằng `node --test scripts/business-connectors/discovery.fixture.ts`. Workflow **Windows business discovery** còn đối chiếu kết quả của CLI với Service Control Manager trên runner Windows dùng một lần. Bằng chứng này chỉ áp dụng cho các nguồn mà runner có.
