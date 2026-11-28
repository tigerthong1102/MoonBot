# Duyệt một đề xuất Zalo với quy trình đã lưu

Trong Settings → nhập dữ liệu, người vận hành dán đoạn văn do mình được phép xem, đặt nhãn nguồn và mở báo cáo. Chọn **Chọn quy trình đã lưu** trên dòng có việc đề xuất. Giao diện giữ nhãn nguồn và số dòng ngay bên cạnh các bước của quy trình. Nhãn nguồn do người nhập cung cấp. Danh tính người gửi và thời gian trên nền tảng chưa được xác minh.

Danh sách lấy từ kho quy trình riêng đã lưu của bot đang được chọn trên desktop. API GET chỉ phục vụ owner của ứng dụng desktop tại máy, kiểm tra attestation và từ chối hosted/companion/service. Nội dung đoạn dán và nhãn nguồn ở lại renderer. Khi mở, chỉ danh sách quy trình đang bật của bot đó được đọc. Mục Saved Steps trong cùng chat, nếu có, dẫn tới bản ghi gần nhất để owner kiểm tra việc đã xảy ra.

Chọn đúng máy cục bộ cho bot/chat và bật quyền dùng máy hiện có. Tick **Công việc này cần Windows** nếu công việc phụ thuộc Windows. Khi máy sai hệ điều hành, thiếu quyền, host chưa kết nối hoặc chưa xác minh được khả năng điều khiển, nút duyệt bị khóa. Tính năng chỉ xét máy đang mở ứng dụng.

Khi bấm duyệt, ứng dụng kiểm tra lại quyền và revision trước khi hiển thị đề xuất. Khi owner mở thư viện Workflow, ứng dụng kiểm tra lần nữa. Thư viện chỉ hiển thị các bước nếu đúng bot, chat và revision đã duyệt; thay đổi hoặc gỡ workflow sẽ buộc người dùng chọn lại. Màn hình này chỉ để xem. Owner có thể mở danh sách quy trình chung để bắt đầu một thao tác mới qua giao diện thông thường. Đề xuất không đưa lệnh vào composer, xếp lịch, chuyển source text hay tạo receipt thực thi.

Có thể chạy các bài hồi quy bằng lệnh sau từ repository.

```sh
pnpm exec vitest run server/routes/zalo-workflow-review.test.ts server/skill-burger/store.test.ts src/components/ZaloWorkflowReview.dom.test.ts src/components/ZaloImportSection.dom.test.ts src/lib/drafts.test.ts
```

GO nội bộ cho việc duyệt nguồn và kiểm tra quy trình. Lệnh từ webhook, chạy nền, gửi ra ngoài, chuyển quyền sang máy khác và thao tác MISA thật chưa được nghiệm thu. Rollback bằng revert PR và đóng report.
