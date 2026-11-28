# AI Twin · Phong cách Zalo từ mẫu chủ sở hữu tự viết

## Nguồn và thao tác

Trong Settings → AI Twin, tạo Twin trên desktop cục bộ, mở **Phong cách Zalo từ mẫu tự viết**. Chủ sở hữu viết một phản hồi tiếng Việt giả định mới trong ô trống (12–750 ký tự), xác nhận quyền tác giả và đồng ý phân tích cục bộ. Ô nhập chặn dán và thả nội dung. Nguồn được xác định bằng capability của chủ desktop và tuyên bố của người viết trong trình soạn. Cơ chế này không chứng thực tác giả lịch sử Zalo hoặc phát hiện chắc chắn văn bản do AI tạo.

Nhấn **Đề xuất đặc điểm cách viết**. Server cục bộ dùng bộ lọc mẫu học hiện có của Twin và phân tích quy tắc để nhận diện cách xưng hô đầu câu, lời mở đầu, độ ngắn của cả phản hồi, dạng danh sách và câu hỏi cuối. Mẫu chứa dữ liệu liên hệ phổ biến, chuỗi số dài hoặc dấu hiệu credential bị từ chối. Bộ lọc không nhận diện được mọi bí mật. Người dùng chỉ nhập ví dụ giả định. Ô soạn và bản sao request dành cho trình quan sát được xóa khi gửi/xử lý. Không lưu nguyên văn.

Người dùng chọn các đặc điểm muốn lưu rồi nhấn **Lưu các đặc điểm đã chọn**, hoặc **Bỏ đề xuất**. Chỉ đặc điểm server quan sát và trả về mới được chấp nhận. Đề xuất có hiệu lực tối đa 5 phút, dùng một lần, gắn với Twin ID và revision. Một đề xuất mới thay thế đề xuất chờ trước đó. Đóng hoặc khởi động lại server làm mất đề xuất đang chờ. Một lần duyệt mới thay thế tập đặc điểm Zalo đã lưu.

Twin hiển thị ví dụ tiếng Việt được tạo bằng mẫu cục bộ từ chính lựa chọn đã duyệt. Ví dụ được tạo để xem và không trở thành dữ liệu học. Tạm dừng Twin sẽ dừng đề xuất và ẩn ví dụ đã tạo. **Xóa phong cách Zalo đã duyệt** và thao tác xóa cả Twin đều thu hồi tập đặc điểm. Có thể xóa riêng phong cách cả khi Twin đang tạm dừng.

## Dữ liệu và phạm vi bằng chứng

Tái sử dụng profile riêng của AI Twin, workspace ID, revision, cơ chế ghi atomic, pause, delete và quy tắc lọc dữ liệu nguồn. Profile lưu danh sách nhãn cố định, nguồn `owner-desktop-editor` và thời điểm chấp thuận. Thông tin này chỉ đọc được qua route riêng của desktop owner. Profile công khai của Twin, câu trả lời trong nhóm, bộ nhớ/lesson chia sẻ và prompt provider không thêm trường này. Mẫu mới không mở quyền đọc tin đến, chọn chat Zalo, nhập transcript, lấy câu trả lời từ AI hay bật quyền trên điện thoại. Không phát sinh request tới Zalo hoặc model provider.

Smoke trên fixture desktop chạy từ checkout, với token owner tạo riêng cho test, đã đi qua cửa xác thực HTTP của server, tạo Twin, xác nhận hai đặc điểm và đọc lại từ profile thật. Workspace backup được tạo và stage lại trên thư mục tạm. Thư mục riêng của Twin không nằm trong dữ liệu được stage. Việc tự sao chép thư mục riêng ngoài luồng backup sản phẩm thuộc quyền của chủ máy.

Chạy `pnpm exec vitest run server/routes/ai-twin-owner-style.test.ts server/ai-twin-learning.test.ts src/components/AiTwinZaloOwnerStyle.dom.test.ts` và `pnpm exec vitest run server/ai-twin.e2e.test.ts -t 'smokes owner-authored Zalo style'`. Fixture kiểm tra thiếu provenance/consent, nguồn giả mạo, OTP, dữ liệu liên hệ, tài khoản không đủ quyền, đổi scope/revision, đề xuất trùng hoặc hết hạn, từ chối, tạm dừng, thu hồi, restart và xóa. Test DOM tiếng Việt đi từ ô trống đến bỏ bớt đặc điểm và xóa kết quả.

Các quy tắc chỉ mô tả một mẫu được chọn. Chưa đánh giá độ tương đồng phong cách trên hội thoại Zalo thật, huấn luyện mô hình hoặc soạn tư vấn thực tế cho từng khách hàng.
