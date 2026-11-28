# Dấu trang Zalo trong Bộ não thứ hai riêng

Pilot này cần desktop owner, Official webhook pilot đã ghép cặp, STARTUPBOT_ZALO_PRIVATE_KNOWLEDGE=1 và STARTUPBOT_ZALO_KNOWLEDGE_WORKSPACE trùng environment ID của workspace cục bộ. Không bật trong bản phân phối mặc định. Khu vực trích dẫn xuất hiện bên trong Bộ não thứ hai. Người dùng mở khu vực để lấy dữ liệu và có thể lọc bằng ô tìm kiếm của thư viện.

Để đề xuất một trích dẫn, người gửi trong chat riêng đã ghép cặp đặt dòng `[Cho phép lưu vào Bộ não thứ hai riêng của chủ bot]` ở đầu tin, rồi viết nội dung ở dòng kế. Chủ máy đọc lại nội dung, nguồn, người gửi, thời điểm và hạn trước khi duyệt. Tin khác không tạo đề xuất. Mục đích là tra cứu riêng trên máy. Quyền đánh dấu không cho phép huấn luyện phong cách, gửi sang model cloud, xuất sang tệp hoặc đưa vào kiến thức tổ chức.

SQLite giữ ID nguồn, grant, workspace, trạng thái và phiên bản duyệt. Nội dung và hạn lấy từ hàng nguồn mỗi lần đọc. Kho ngoài workspace backup. Bỏ dấu trang làm mất hiệu lực bản duyệt cũ. Xóa dòng gốc hoặc xóa grant sẽ xóa cả dấu trang. Nguồn hết hạn bị ẩn cả khi chưa có lượt ghi mới. Màn hình gỡ dữ liệu khi mất focus theo sự kiện ẩn tab, khi làm mới quyền và khi đến hạn. Thu hồi từ một tiến trình khác được nhận biết trong lần đọc lại, tối đa 15 giây khi cửa sổ mở trên máy còn hoạt động. Đây không phải thông báo thu hồi trực tuyến từ Zalo.

Đường đề xuất hiển thị tối đa 20 mục mới nhất mỗi trạng thái, chỉ văn bản tối đa 1.000 ký tự, lọc dạng credential đã biết. Dấu trang không thay thế quyền của người gửi với nội dung họ đề xuất. Nhận dấu đồng ý trên kênh thử nghiệm và quyền xem tại máy không chứng minh có quyền lưu trữ dữ liệu doanh nghiệp. Tắt flag để ngừng truy cập. Có thể gỡ bằng revert sau khi thu hồi/xóa nguồn. Cấu trúc SQLite bổ sung tương thích ngược.

Chạy `pnpm exec vitest run server/zalo-knowledge-bookmarks.test.ts` để kiểm API loopback, nguồn không đồng ý, xác nhận hai phía, giới hạn workspace, restart, xóa theo khoảng, thu hồi và hết hạn bằng fixture tổng hợp.
