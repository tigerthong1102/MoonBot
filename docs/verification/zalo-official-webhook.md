# Webhook Zalo Official và ghép cặp nội bộ

Bộ thu thử nghiệm ghép một Zalo Bot với một chat cá nhân và một người gửi cho mục đích lưu văn bản. Chủ sở hữu desktop quản lý ghép cặp từ Settings khi đã cấu hình pilot cục bộ. Đường dẫn HTTP nhận sự kiện dùng đúng hợp đồng `IngressDoor` của StartupBot. Bộ kiểm thử gắn nó vào `listenWebhookIngress` trên 127.0.0.1 với cổng do hệ điều hành cấp và cơ sở dữ liệu tạm riêng. Bản desktop và máy chủ gửi webhook hiện tại không tự gắn bộ thu.

## Quy trình

1. Sử dụng bot thử riêng và xác minh ID bot bằng probe desktop. Người vận hành mở DB SQLite riêng đã được phê duyệt cho pilot. Cờ `STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT=1` chỉ cho phép module hoạt động trong tiến trình gọi nó.
2. Gọi `register(accountId)` để cấp đường dẫn ngẫu nhiên và secret webhook 256 bit, chỉ trả về secret khi đăng ký. DB giữ SHA-256 của secret. Bot token dùng gọi API và secret webhook là hai credential riêng. Mỗi bot có tối đa một endpoint. Lượt polling đang chạy hoặc grant trước đó sẽ chặn đăng ký. Khi endpoint còn đăng ký, lease mới cho polling cùng bot bị chặn.
3. Người vận hành gọi `invite(endpoint)` và trao mã riêng cho người dự kiến ghép. Người đó gửi `/pair <mã>` vào chat riêng của bot. Mã có 128 bit ngẫu nhiên, hết hạn sau 5 phút. Năm lần sai với các message ID khác nhau khóa mã đó. Gửi lại cùng một sự kiện sai chỉ tính một lần. Việc cấp mã mới thay mã cũ.
4. Qua kênh tin cậy, người vận hành đối chiếu ID người gửi và ID chat do `candidate(endpoint)` trả về với người đang được ghép. Gọi `approve(endpoint, candidate, retentionDays)` để chấp thuận đúng cặp. Một gói tin có secret hợp lệ hoặc một người biết mã chưa đủ để tạo grant. Mã đã dùng không chuyển grant sang người khác.
5. Chỉ sự kiện text riêng khớp sender, chat, account và thời gian sau phê duyệt mới được lưu. Bộ thu kiểm tra secret trước khi đọc body và xác thực lại trong transaction trước khi xử lý. Giới hạn 256 KiB/body và tối đa 8 body đang đọc cho mỗi receiver. Bộ thu chấp nhận thời gian phía Zalo đi trước tối đa 5 phút cho event hiện thuộc grant. Nếu vượt ngưỡng, nó trả 503 với Retry-After và ghi nhận tình trạng thiếu dữ liệu. Event đến trước/cùng thời điểm cấp grant hoặc request đang mở khi grant đổi bị loại. Với event có timestamp đi trước hoặc đi qua thời điểm chuyển grant, SQLite lưu HMAC của ID hội thoại và message ID bằng secret của endpoint, timestamp nguồn cùng epoch quyền quan sát lúc đầu. Dấu chặn không chứa nội dung hoặc ID người gửi. Khi bản phát lại có thể thuộc grant khác với lần quan sát đầu, cửa nhận vẫn đóng kể cả sau restart. Dấu chặn được dọn khi thời hạn và epoch không còn cho phép phát lại, hoặc khi gỡ endpoint. Quá 4.096 dấu đang chờ cho một endpoint sẽ đưa nó vào trạng thái cần vận hành viên kiểm tra, thu hồi rồi đăng ký lại. Coverage của grant liệt kê nguyên nhân và thời điểm gần nhất của sự kiện bị loại do thời gian hoặc quyền. Nội dung được xem là dữ liệu. Nó không khởi chạy bot, gửi tin trả lời, tải file hoặc thực thi lệnh.
6. `remove(endpoint)` hủy secret địa phương, challenge và grant cùng dữ liệu liên quan trong một transaction. Việc thu hồi địa phương không cập nhật đăng ký webhook trên Zalo. Quản trị viên cần xử lý cấu hình nền tảng riêng nếu đã triển khai ở môi trường được phép. `purgeExpired()` dọn thông tin ghép hết hạn khi host nhàn rỗi; module cũng dọn khi mở DB và lúc nhận sự kiện. DB, journal và bản sao thuộc phạm vi giữ liệu của chủ thể vận hành, ngoài backup ứng dụng.

## Biên nhận và quyền

| Kết quả HTTP | Ý nghĩa |
|---|---|
| 204 | Đã commit tin hợp lệ, đã nhận bản trùng, hoặc đã bỏ qua sự kiện ngoài phạm vi. Không trả dữ liệu hội thoại cho caller. |
| 400 / 413 / 415 | Payload sai hoặc vượt giới hạn, hoặc content type không phù hợp. |
| 403 / 404 | Sai secret, endpoint đã thu hồi hoặc pilot tắt. |
| 409 | Message ID cũ có nội dung khác. Bản đã lưu tiếp tục là dữ liệu gốc, cần đối chiếu. |
| 429 | Challenge đã vượt số lần thử hoặc receiver đang bận. |
| 503 | Không xác minh/ghi được trạng thái, hoặc timestamp chưa thể tiếp nhận. Trả Retry-After 30 giây; việc Zalo có thực hiện lại chưa được kiểm chứng. |

Secret gắn với endpoint xác thực bên nắm secret. Nền tảng công bố header `X-Bot-Api-Secret-Token`, yêu cầu webhook HTTPS công khai và mô tả 2xx là kết quả thành công cho phép kiểm tra endpoint. Tài liệu hiện có không chứng minh thời gian retry, độ phủ lịch sử hoặc delivery đúng một lần. [setWebhook](https://bot.zapps.me/docs/apis/setWebhook/) · [Webhook](https://bot.zapps.me/docs/webhook/) · [testWebhook](https://bot.zapps.me/docs/apis/testWebhook/)

## Bằng chứng và quyết định

Chạy `pnpm exec vitest run server/zalo-webhook.test.ts server/zalo-inbox.test.ts server/zalo-official.test.ts`. Fixture dùng HTTP loopback thật, hai kết nối SQLite, restart receiver, giao dịch bị ép rollback, kiểm tra lại dữ liệu sau ACK, replay trước/sau ghép và lệnh thu hồi. Biên soạn mới dựa trên hợp đồng công khai của Zalo, dùng credential tạm và dữ liệu tổng hợp. Không có dependency bổ sung.

**GO** cho fixture nội bộ và đánh giá thiết kế. **NO-GO** cho triển khai công khai. Chưa thử vendor → TLS → receiver, chưa có endpoint HTTPS thật, xác nhận quyền vận hành, consent thực tế, bài thử lưu lượng dài hạn hoặc kiểm chứng cấu hình proxy. Giao diện pilot desktop đã kiểm thử với webhook mô phỏng. Chưa nghiệm thu một triển khai cho khách hàng. Các bài kiểm tra nội bộ không thay thế phép thử với bot Zalo có quyền.

## Quản lý trên desktop

1. Host đã được phép triển khai pilot cần dùng một SQLite riêng tại `~/.startupbot-qualification/zalo-official/inbox.sqlite`. Dùng cùng tệp cho `createZaloWebhookPilot(db)` của host và desktop. Sau khi xác minh ID bot thử riêng bằng probe, người vận hành cấp endpoint bằng `register(accountId)` ở host và giữ webhook secret trong kênh vận hành an toàn. Đây là bước chuẩn bị của host, bộ cài desktop không tự đăng ký webhook hay mở listener.
2. Cấp `STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID` cho chính bot đó và bật hai flag sẵn có `STARTUPBOT_ZALO_OFFICIAL_PILOT=1` cùng `STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT=1` cho desktop nội bộ. Trên POSIX, chủ hiện tại sở hữu hai thư mục pilot với mode 0700 và tệp cùng các SQLite sidecar với mode 0600. Trên Windows dùng ACL riêng của hồ sơ người dùng. Endpoint, tên tệp và tài khoản không thể bị đổi từ yêu cầu của giao diện. Khi chưa được cấp endpoint, Settings hiện trạng thái thiếu cấu hình.
3. Mở Settings → Import → Zalo Bot chính thức → Ghép cặp chat riêng. Kiểm tra ID bot của webhook rồi chọn **Cấp mã riêng**. Trao lệnh riêng cho đúng người và yêu cầu họ gửi vào chat riêng của bot. Mã chỉ hiển thị trong phản hồi cấp mã, được xóa khỏi giao diện khi tải lại, đóng trang hoặc hết 5 phút. **Thay mã ghép cặp** sẽ hủy mã và ứng viên trước đó.
4. Chọn **Tải lại trạng thái** để xem đúng hai ID của callback nhận mã. Đối chiếu độc lập với người tham gia, nhập lại cả hai ID và chọn thời hạn giữ văn bản 1–365 ngày (mặc định trên form là 7). Chỉ người sở hữu desktop mới có thể duyệt. Server kiểm tra revision theo trạng thái endpoint và danh tính ngay trong giao dịch SQLite cùng việc cấp quyền.
5. Mục trạng thái hiển thị người gửi, chat, số tin còn lưu, thời gian tin sớm nhất/gần nhất, số khoảng trống polling gần đây (tối đa 50) và số loại lỗi thời gian webhook. Hộp thư dọn bản ghi hết hạn khi đọc coverage. Lịch sử có thể thiếu. Host cần gọi `pilot.purgeExpired()` định kỳ để dọn tin và mã hết hạn ngay cả khi nhàn rỗi. Giao diện chỉ hiện metadata.
6. Chọn **Thu hồi endpoint**, đọc phạm vi xóa và xác nhận để xóa pairing, challenge, secret hash cùng tin đã lưu của endpoint. Endpoint khác giữ quyền riêng của nó. Việc thu hồi cấu hình trên Zalo do người vận hành thực hiện riêng.

Route `/api/zalo-official/pairing` yêu cầu owner của desktop cục bộ và cả hai flag. Companion, session, tài khoản dịch vụ và loopback shell không đủ quyền. API trả `Cache-Control: no-store` và không trả webhook secret, URL callback hoặc nội dung tin nhắn. API xác minh token và API quản lý pairing dùng hai thao tác riêng. Lượt smoke HTTP loopback dùng endpoint và tài khoản giả trên DB tạm, đi từ tạo mã đến kiểm tra lại xóa từ kết nối SQLite thứ hai. Kiểm thử DOM bao phủ toàn bộ biểu mẫu Settings tiếng Việt, cả trường hợp pilot tắt.

Chạy `pnpm exec vitest run server/routes/zalo-pairing.test.ts src/components/ZaloPairingSetup.dom.test.ts server/zalo-webhook.test.ts`. Các bài kiểm thử chỉ dùng dữ liệu tổng hợp. Sản phẩm chưa triển khai endpoint TLS công khai hoặc xác minh callback do Zalo gửi thật tới giao diện pilot này.
