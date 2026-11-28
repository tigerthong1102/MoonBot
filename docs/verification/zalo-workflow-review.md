# Duyệt một đề xuất Zalo để soạn lệnh quy trình

Trong Settings → nhập dữ liệu, người vận hành dán đoạn văn do mình được phép xem, đặt nhãn nguồn và mở báo cáo. Chọn **Chọn quy trình đã lưu** trên dòng có việc đề xuất. Giao diện giữ nhãn nguồn và số dòng ngay bên cạnh các bước của quy trình. Nhãn nguồn do người nhập cung cấp. Danh tính người gửi và thời gian trên nền tảng chưa được xác minh.

Danh sách lấy từ kho quy trình riêng đã lưu của bot đang được chọn trên desktop. API GET chỉ phục vụ owner của ứng dụng desktop tại máy, kiểm tra attestation và từ chối hosted/companion/service. Nội dung đoạn dán và nhãn nguồn ở lại renderer. Khi mở, chỉ danh sách quy trình đang bật của bot đó được đọc. Mục Saved Steps trong cùng chat, nếu có, dẫn tới bản ghi gần nhất để owner kiểm tra việc đã xảy ra.

Để soạn lệnh, chọn đúng máy cục bộ cho bot/chat và bật quyền dùng máy hiện có. Tick **Công việc này cần Windows** nếu công việc phụ thuộc Windows. Máy sai hệ điều hành, thiếu quyền, host chưa kết nối hoặc không xác minh được khả năng điều khiển làm nút duyệt bị khóa. Tính năng chỉ xét máy đang mở ứng dụng. Không giả lập việc kết nối hay đánh thức máy Windows từ xa.

Khi bấm duyệt, ứng dụng kiểm tra lại quyền và revision quy trình trước khi ghi đúng lệnh của catalog vào bản nháp chat đang trống. Nếu có tệp đính kèm, một lệnh đang chờ gửi lại, reply hoặc bản nháp, người dùng cần kiểm tra bản đang có. Người dùng mở chat, xác nhận lại đầu vào và dùng nút gửi bình thường nếu muốn tiếp tục. Việc soạn nháp không tạo execution receipt, task hoàn thành hay tin gửi ra Zalo.

Có thể chạy các bài hồi quy bằng lệnh sau từ repository.

```sh
pnpm exec vitest run server/routes/zalo-workflow-review.test.ts server/skill-burger/store.test.ts src/components/ZaloWorkflowReview.dom.test.ts src/components/ZaloImportSection.dom.test.ts src/lib/drafts.test.ts
```

GO nội bộ cho việc duyệt nguồn và soạn nháp. Lệnh từ webhook, chạy nền, gửi ra ngoài, chuyển quyền sang máy khác và thao tác MISA thật chưa được nghiệm thu. Rollback bằng revert PR, đóng report và xóa bản nháp mà owner đã tạo trong chat nếu cần.
