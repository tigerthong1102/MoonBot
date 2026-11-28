# Webhook Zalo Official và ghép cặp nội bộ

Bộ thu thử nghiệm ghép một Zalo Bot với một chat cá nhân và một người gửi cho mục đích lưu văn bản. Lệnh quản lý chỉ dành cho tiến trình vận hành cục bộ. Đường dẫn HTTP nhận sự kiện dùng đúng hợp đồng `IngressDoor` của StartupBot. Bộ kiểm thử gắn nó vào `listenWebhookIngress` trên 127.0.0.1 với cổng do hệ điều hành cấp và cơ sở dữ liệu tạm riêng. Bản desktop và máy chủ gửi webhook hiện tại không tự gắn bộ thu.

## Quy trình

1. Sử dụng bot thử riêng và xác minh ID bot bằng probe desktop. Người vận hành mở DB SQLite riêng đã được phê duyệt cho pilot. Cờ `STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT=1` chỉ cho phép module hoạt động trong tiến trình gọi nó.
2. Gọi `register(accountId)` để cấp đường dẫn ngẫu nhiên và secret webhook 256 bit, chỉ trả về secret khi đăng ký. DB giữ SHA-256 của secret. Bot token dùng gọi API và secret webhook là hai credential riêng. Mỗi bot có tối đa một endpoint. Lượt polling đang chạy hoặc grant trước đó sẽ chặn đăng ký. Khi endpoint còn đăng ký, lease mới cho polling cùng bot bị chặn.
3. Người vận hành gọi `invite(endpoint)` và trao mã riêng cho người dự kiến ghép. Người đó gửi `/pair <mã>` vào chat riêng của bot. Mã có 128 bit ngẫu nhiên, hết hạn sau 5 phút. Năm lần sai với các message ID khác nhau khóa mã đó. Gửi lại cùng một sự kiện sai chỉ tính một lần. Việc cấp mã mới thay mã cũ.
4. Qua kênh tin cậy, người vận hành đối chiếu ID người gửi và ID chat do `candidate(endpoint)` trả về với người đang được ghép. Gọi `approve(endpoint, candidate, retentionDays)` để chấp thuận đúng cặp. Một gói tin có secret hợp lệ hoặc một người biết mã chưa đủ để tạo grant. Mã đã dùng không chuyển grant sang người khác.
5. Chỉ sự kiện text riêng khớp sender, chat, account và thời gian sau phê duyệt mới được lưu. Bộ thu kiểm tra secret trước khi đọc body và xác thực lại trong transaction trước khi xử lý. Giới hạn 256 KiB/body và tối đa 8 body đang đọc cho mỗi receiver. Timestamp trong tương lai hoặc cùng mili giây với thời điểm cấp grant bị bỏ qua để hạn chế replay qua lần ghép mới. Nội dung được xem là dữ liệu. Nó không khởi chạy bot, gửi tin trả lời, tải file hoặc thực thi lệnh.
6. `remove(endpoint)` hủy secret địa phương, challenge và grant cùng dữ liệu liên quan trong một transaction. Việc thu hồi địa phương không cập nhật đăng ký webhook trên Zalo. Quản trị viên cần xử lý cấu hình nền tảng riêng nếu đã triển khai ở môi trường được phép. `purgeExpired()` dọn thông tin ghép hết hạn khi host nhàn rỗi; module cũng dọn khi mở DB và lúc nhận sự kiện. DB, journal và bản sao thuộc phạm vi giữ liệu của chủ thể vận hành, ngoài backup ứng dụng.

## Biên nhận và quyền

| Kết quả HTTP | Ý nghĩa |
|---|---|
| 204 | Đã commit tin hợp lệ, đã nhận bản trùng, hoặc đã bỏ qua sự kiện ngoài phạm vi. Không trả dữ liệu hội thoại cho caller. |
| 400 / 413 / 415 | Payload sai hoặc vượt giới hạn, hoặc content type không phù hợp. |
| 403 / 404 | Sai secret, endpoint đã thu hồi hoặc pilot tắt. |
| 409 | Message ID cũ có nội dung khác. Bản đã lưu tiếp tục là dữ liệu gốc, cần đối chiếu. |
| 429 | Challenge đã vượt số lần thử hoặc receiver đang bận. |
| 503 | Không xác minh/ghi được trạng thái. Bộ thu không trả 2xx cho giao dịch ghi đang lỗi. |

Secret gắn với endpoint xác thực bên nắm secret. Nền tảng công bố header `X-Bot-Api-Secret-Token`, yêu cầu webhook HTTPS công khai và mô tả 2xx là kết quả thành công cho phép kiểm tra endpoint. Tài liệu hiện có không chứng minh thời gian retry, độ phủ lịch sử hoặc delivery đúng một lần. [setWebhook](https://bot.zapps.me/docs/apis/setWebhook/) · [Webhook](https://bot.zapps.me/docs/webhook/) · [testWebhook](https://bot.zapps.me/docs/apis/testWebhook/)

## Bằng chứng và quyết định

Chạy `pnpm exec vitest run server/zalo-webhook.test.ts server/zalo-inbox.test.ts server/zalo-official.test.ts`. Fixture dùng HTTP loopback thật, hai kết nối SQLite, restart receiver, giao dịch bị ép rollback, kiểm tra lại dữ liệu sau ACK, replay trước/sau ghép và lệnh thu hồi. Biên soạn mới dựa trên hợp đồng công khai của Zalo, dùng credential tạm và dữ liệu tổng hợp. Không có dependency bổ sung.

**GO** cho fixture nội bộ và đánh giá thiết kế. **NO-GO** cho triển khai công khai. Chưa thử vendor → TLS → receiver, chưa có endpoint HTTPS thật, xác nhận quyền vận hành, consent thực tế, bài thử lưu lượng dài hạn hoặc kiểm chứng cấu hình proxy. Bộ thu chưa có giao diện người vận hành để trao mã/duyệt ghép trên bản bán cho khách. Các bài kiểm tra nội bộ không thay thế phép thử với bot Zalo có quyền.
