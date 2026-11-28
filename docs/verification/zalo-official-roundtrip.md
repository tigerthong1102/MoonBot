# Kiểm thử hai chiều với Zalo Bot chính thức

## Phạm vi và bằng chứng

Người vận hành đã thử với một bot dành riêng cho QA và một người dùng đồng ý tham gia trong chat riêng. Khi long poll đang chờ, Zalo chuyển mã thử và nội dung tổng hợp, trả mã tin nhắn cho một lần gửi. Người vận hành đọc lại phản hồi trên Zalo Desktop. Mẫu “Anh cần đối soát công nợ gấp.” được bộ quy tắc phân loại là đối soát và khẩn. Phép thử trước đây dùng công cụ tạm thời. CLI trong tài liệu này đã được kiểm tra bằng transport mô phỏng. Chưa đo tỉ lệ thành công trên các bot khác, khả năng chạy nền hay độ phủ lịch sử.

## Chạy thủ công

1. Dùng checkout đã cài dependency của dự án và Node 24 trở lên. Chủ bot chọn một bot dành riêng cho phép thử, xác nhận chỉ có một người tham gia, một terminal và một tiến trình nhận update cho bot. Long polling có thể lấy cả tin bất ngờ đang chờ trong hàng đợi của bot.
2. Cấp riêng cho tiến trình terminal các biến `STARTUPBOT_ZALO_OFFICIAL_PILOT=1`, `STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID` và `STARTUPBOT_ZALO_OFFICIAL_BOT_TOKEN` qua trình quản lý bí mật. ID là danh tính bot dự kiến. Token dùng để đối chiếu ID qua `getMe`. Giữ phiên terminal riêng, tắt ghi phiên và công cụ ghi URL HTTP vì Zalo đặt token trong đường dẫn.
3. Chạy lệnh sau một lần trong terminal tương tác.

   ```sh
   node scripts/qualification/zalo-official/roundtrip.ts --confirm-one-private-test-reply
   ```

4. Từ cùng một người dùng, gửi lần lượt mã ngẫu nhiên trên terminal và đúng câu “Anh cần đối soát công nợ gấp.” vào cùng chat riêng của bot. CLI chờ tối đa 120 giây hoặc 10 lượt poll. Mỗi lượt long poll yêu cầu 15 giây. CLI dừng khi gặp update ngoài kịch bản, kể cả tin từ nhóm hoặc người khác.
5. Khi phân loại khớp, CLI gửi một lần câu “StartupBot đã phân loại mẫu kiểm thử là yêu cầu đối soát công nợ khẩn.” tới đúng chat đã gửi mã. Kết quả `provider-acknowledged` cho biết Zalo đã trả ID tin nhắn. Người tham gia đọc lại tin trong Zalo để xác nhận hiển thị. Chỉ ghi trạng thái kết quả vào báo cáo.

Dùng Ctrl+C để hủy đợi. Bot không cần biết trước ID người gửi hoặc ID chat. Cờ đồng ý cho phép gửi đúng một phản hồi mẫu. CLI chỉ hiển thị chỉ dẫn thử và mã trạng thái. Mỗi lần bắt đầu sinh một challenge 144 bit mới.

## Điều kiện dừng

Phép thử xác minh webhook trước mỗi lượt đọc và ngay trước yêu cầu gửi. URL webhook đang hoạt động chặn polling và gửi. Ngoài phản hồi thành công có URL rỗng, CLI cho phép chính dạng đã thấy trên bot thử, HTTP 200, `ok=false`, mã API 404, mô tả “Not Found” (so khớp sau khi bỏ khoảng trắng hai đầu và đổi về chữ thường), result rỗng hoặc vắng. Dạng này chỉ là cơ sở tiến hành phép thử thủ công trên bot dành riêng. Adapter chạy không giám sát vẫn dừng khi trạng thái webhook chưa xác minh. Phản hồi rỗng của poll trong phép thử có HTTP 200 và mã API 408. HTTP khác 200, lỗi xác thực, phản hồi bất thường và vượt giới hạn đều kết thúc lượt chạy. CLI không gọi phương thức thay đổi webhook. [getUpdates](https://bot.zapps.me/docs/apis/getUpdates/) · [getWebhookInfo](https://bot.zapps.me/docs/apis/getWebhookInfo/) · [sendMessage](https://bot.zapps.me/docs/apis/sendMessage/)

CLI tạo journal riêng tại `~/.startupbot-qualification/zalo-official/receipts.sqlite`. Tệp chứa khóa HMAC ngẫu nhiên cục bộ, dấu HMAC của bot và tin mẫu, lease theo bot và trạng thái xác nhận. Token, challenge, ID thực, nội dung mẫu và nội dung phản hồi không được ghi vào DB. Trên POSIX, CLI kiểm tra quyền sở hữu và mode của các thư mục và tệp. Trên Windows, chạy trong hồ sơ cá nhân đã giới hạn ACL. CLI từ chối junction, symlink và tệp có nhiều hard link. Lease chỉ điều phối các tiến trình dùng cùng tệp. Mọi lần gửi đều ghi trạng thái chưa rõ vào journal trước khi gọi API. Nếu mất kết nối, dừng tiến trình hay receipt sai dạng, lần chạy sau sẽ bị khóa cho bot đó. Khi gặp `delivery-unknown` hoặc `blocked-by-prior-run`, dừng và kiểm tra chat riêng cùng người tham gia. Giữ nguyên journal. Một receipt đã xác nhận cũng chặn gửi lại cho cùng message ID.

## Hồi quy offline

Chạy `pnpm exec vitest run server/zalo-official-roundtrip.test.ts server/zalo-official.test.ts`. Fixture kiểm tra bot sai, webhook thay đổi khi đang chờ, quyền riêng của người gửi, độ mới và thứ tự tin, challenge mới, đúng mẫu, giới hạn polling, biên nhận mất, gửi trùng sau khi mở lại SQLite, hai runtime tranh lease và cờ vận hành. Test dùng thông tin tổng hợp, không gọi Zalo.
