# Đối chiếu chứng từ từ hai tệp

Trong bảng Data của StartupBot, chọn **Đối chiếu chứng từ**. Hoặc mở bản HTML độc lập bằng Chrome/Edge hiện đại. Cả hai dùng cùng bộ so sánh. Công cụ đọc hai tệp gốc trong bộ nhớ. Khi chọn **Ghi thay đổi** trên một chứng từ, trình duyệt lưu bảng kết quả và lịch sử chỉnh sửa trên thiết bị. Trong StartupBot, bảng đã lưu gắn với phiên đăng nhập và cuộc trò chuyện.

1. Chọn tệp nghiệp vụ và báo cáo đối chứng độc lập, cùng đơn vị tiền tệ và quy ước dấu.
2. Mỗi tệp cần có bốn cột có thể ánh xạ: mã công ty, kỳ, số chứng từ và số tiền. Chọn đúng cột ở từng bên. Kỳ là giá trị nguyên văn, chẳng hạn 2025 hoặc 2025-12. Một file nhiều công ty được lọc theo mã chính xác. Công cụ không suy ra công ty từ tên tệp.
3. Điền công ty và kỳ. Chọn dấu thập phân theo từng tệp. Tiền dạng văn bản cần bỏ dấu phân cách hàng nghìn, giữ cả dấu âm và phần lẻ. Mã doanh nghiệp và số chứng từ trong Excel cần ở dạng văn bản để giữ số 0 đầu.
4. Chọn **Đối chiếu**. Công cụ cộng theo số chứng từ trong phạm vi đã chọn và tính chênh lệch bằng tiền của tệp trừ tiền của báo cáo đối chứng. Nhiều dòng chung số chứng từ được đưa vào báo cáo để kiểm tra, kể cả khi tổng khớp. Một chứng từ nhiều mặt hàng có thể hợp lệ. Ô trống phía thiếu trong báo cáo khác với số tiền bằng không.
5. Chọn số chứng từ để giao người xử lý hoặc cập nhật trạng thái. **Ghi thay đổi** lưu người xử lý, trạng thái và thời điểm. Mở lại công cụ để tiếp tục với bảng gần nhất hoặc chọn một bảng đã lưu trên máy. **Lưu tệp theo dõi** và **Mở tệp theo dõi** dùng khi chuyển thiết bị hoặc sao lưu.
6. **Tải báo cáo HTML** tạo bản in cục bộ cho đúng phạm vi, có tất cả ngoại lệ. Nếu đổi tệp, ánh xạ hoặc phạm vi, cần chạy lại.

Hỗ trợ CSV UTF-8 và XLSX một trang hiển thị với tiêu đề ở dòng dữ liệu đầu tiên. Giới hạn mỗi tệp 4 MiB, 128 cột và 50.000 dòng dữ liệu. File XLSX có công thức trong trang được đọc, ô gộp, macro hoặc externalLinks cần xuất lại theo dạng giá trị. Bản xuất chứa hàng tiêu đề báo cáo, ngày Excel dạng số serial, mẫu nhiều trang, nhiều đơn vị tiền tệ hoặc thiếu mã công ty/kỳ cần chuẩn hóa trước. Quyền chọn lọc trong công cụ thuộc về người đã có quyền đọc hai file. Chưa kiểm chứng template theo phiên bản của hãng.

Để thử không cần dữ liệu thật, chọn **Dùng dữ liệu mẫu** rồi **Đối chiếu**. Kết quả của CT01, kỳ 2025 là ba chứng từ cần kiểm tra và tổng chênh 0.0100.

Trong checkout phát triển có dependencies, tạo HTML tự chứa bằng `node scripts/business-connectors/reconcile/build.mjs`. File nằm ở `dist/reconciliation/doi-chieu.html`. Người mở bản HTML không cần Node hay kết nối mạng.

## Quyền thực thi trong renderer

Nút Đối chiếu cấp quyền một lần cho operation `exports.reconcile` trong registry tĩnh. Trước khi thực thi, adapter tạo hai bản tổng hợp theo đúng công ty, kỳ và cột người dùng vừa duyệt. Operation nhận tổng từng chứng từ trong phạm vi đó. Đổi file hoặc lựa chọn sau thời điểm cấp không làm đổi bản tổng hợp. Registry chỉ chấp nhận đúng đối tượng quyền do phiên renderer hiện tại cấp và tiêu thụ quyền ngay khi thực thi. Hai tệp đầu vào và quyền thực thi tồn tại trong phiên renderer. Bảng kết quả người dùng theo dõi được lưu cục bộ. Các kiểm thử ở `src/business-reconciliation/operations.test.ts` dùng hai công ty và hai kỳ.

Mô hình này dành cho người đã có quyền mở hai file trên máy. Khi kết nối cơ sở dữ liệu hoặc MCP qua tiến trình khác, cần xác thực principal ở nơi truy cập dữ liệu và ràng buộc quyền với công ty trước truy vấn. Phạm vi kiểm chứng hiện tại là file CSV/XLSX do người dùng chọn.
