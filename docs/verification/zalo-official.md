# Zalo Bot chính thức

## Quyết định triển khai

Adapter nội bộ dùng API của tài khoản Bot và một lượt long polling cho bộ kiểm thử. Khi triển khai thử có cấp quyền, người vận hành dùng một bot thử nghiệm riêng ghép với đúng một người gửi trong một chat cá nhân. SQLite từ chối cấp grant Official thứ hai cho cùng bot. Mọi runtime cho bot đó phải dùng cùng kho quyền và lease. Các tiến trình ngoài StartupBot có token riêng vẫn có thể tranh chấp lượt nhận. Probe đối chiếu ID cấu hình với `getMe`, tiếp theo đọc `getWebhookInfo`. Probe có thể chạy khi webhook đang hoạt động. Thao tác nhận sẽ dừng nếu webhook đang hoạt động, trạng thái chưa xác minh hoặc phản hồi 404. OpenClaw tại commit `6ea542fd97e2876aa4c871ccc494ed5419a03c5c` có nhánh tự xóa webhook đã cấu hình trước khi polling. Thao tác đó có thể ngắt một hệ thống khác đang vận hành. [Mã nguồn OpenClaw](https://github.com/openclaw/openclaw/blob/6ea542fd97e2876aa4c871ccc494ed5419a03c5c/extensions/zalo/src/monitor.ts) · [getUpdates](https://bot.zapps.me/docs/apis/getUpdates/) · [getWebhookInfo](https://bot.zapps.me/docs/apis/getWebhookInfo/)

StartupBot viết adapter mới từ hợp đồng HTTP. Mã dùng Node fetch và Zod đã có trong dự án. Điểm tới HTTPS cố định, chính sách redirect và giới hạn 64 KiB áp dụng cho mọi phản hồi. Token nằm trong đường dẫn theo giao thức Zalo. Mã lỗi trả về chỉ gồm mã nội bộ, do đó người vận hành có thể ghi lại kết quả probe mà không cần lưu URL, tên tài khoản hoặc nội dung. [Xác thực Zalo](https://bot.zapps.me/docs/authorize/)

## Xác minh nội bộ

Chạy `pnpm exec vitest run server/zalo-official.test.ts server/zalo-inbox.test.ts` trong worktree. Transport mô phỏng xác nhận thứ tự probe, chính sách nhận theo người gửi và chat, giới hạn kích thước, thu hồi quyền khi đang chờ, xung đột poll trong một tiến trình và kết quả lưu chưa xác định.

Lệnh vận hành probe là `node server/zalo-official-probe.ts` với Node 24 trở lên tại checkout đã cài dependencies. Khi có quyền thử, cấp riêng cho tiến trình này các biến `STARTUPBOT_ZALO_OFFICIAL_PILOT=1`, `STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID` và `STARTUPBOT_ZALO_OFFICIAL_BOT_TOKEN` qua trình quản lý bí mật. Trường `identityVerified` xác nhận đúng bot. Trường `webhookConfigured` bằng true khi thấy URL đang đăng ký, false khi provider trả URL rỗng rõ ràng và null khi chưa xác minh được. Nếu getMe thành công và getWebhookInfo trả HTTP 404 hoặc HTTP 200 với `ok=false,error_code=404`, probe báo `identityVerified=true,webhookConfigured=null,webhookError="webhook-not-found"` và exit 2. Không in description từ provider. Bảng mã chung của Zalo mô tả 404 cho đường dẫn hoặc tên API; trang getWebhookInfo chỉ minh họa phản hồi thành công có URL. Hai nguồn này chưa chứng minh 404 đồng nghĩa với việc bot chưa cài webhook. Production và fixture đều từ chối poll trong trạng thái này. [getWebhookInfo](https://bot.zapps.me/docs/apis/getWebhookInfo/) · [bảng mã lỗi](https://bot.zapps.me/docs/error-code/) Probe dùng hai lệnh đọc, không tiêu thụ update. Mặc định flag tắt. Bằng chứng live do người vận hành cung cấp xác nhận getMe trả đúng bot và getWebhookInfo trả mã API 404 trong HTTP 200. Việc nhận tin từ Zalo thật vẫn chưa được kiểm chứng.

## Kiểm tra trong ứng dụng desktop

Ở bản desktop nội bộ bật flag, mở Settings → Import → Zalo Bot chính thức, nhập Bot Token do Zalo cấp rồi chọn Xác minh bot. StartupBot xóa giá trị khỏi ô nhập ngay khi gửi và hiển thị tên/ID bot do Zalo xác thực cùng trạng thái webhook. Token được chuyển qua API cùng origin của desktop đến đúng Zalo Bot API để chạy probe; ứng dụng không ghi token vào cấu hình, Vault, bộ nhớ chat hay nhật ký. Muốn kiểm tra lần nữa phải nhập lại token. Thẻ chỉ xuất hiện sau khi server xác nhận desktop owner và flag. Tắt flag hoặc đóng ứng dụng kết thúc luồng thử nghiệm. Shell loopback, companion, trình duyệt từ xa và cloud bị từ chối.

Luồng này chỉ xác minh thông tin bot. Nhận tin, gửi thử, đăng ký webhook và xóa webhook cần các thao tác khác. Kiểm thử tích hợp sử dụng route HTTP với transport Zalo mô phỏng, cùng DOM tiếng Việt để kiểm tra trạng thái xác minh và xóa giá trị ô nhập.

## Tiếp nhận và quyền

Fixture gọi `receiveOfficialIntoInbox(reader, inbox, grantId, signal)`. Host tạo `createZaloInbox(db)` từ SQLite riêng của một chủ thể, ngoài cây dữ liệu được sao lưu. Hộp thư dùng lại Node SQLite của StartupBot và tách bảng khỏi transcript, bộ nhớ, tìm kiếm và đồng bộ đám mây. Hàm nhận giữ lease theo bot trước khi gọi Zalo. Mỗi lần ghi dùng BEGIN IMMEDIATE để kiểm tra epoch, lease và tuple adapter/tài khoản/loại hội thoại/ID hội thoại/người gửi, rồi ghi hoặc đối chiếu trùng trong cùng giao dịch. Một message ID có nội dung khác báo `conflict` và giữ bản đã ghi. Một runtime cũ không thể ghi qua lease hết hạn. Khi callback báo lỗi, host ghi nhận kết quả chưa xác định. Giao thức polling có thể đã tiêu thụ update trước khi host ghi xong. Khoảng đó thuộc phần dữ liệu có thể thiếu của báo cáo.

Sự kiện text cá nhân được chuẩn hóa theo `shared/zalo-event.ts` và chỉ chuyển vào sink cấp quyền. Event nhóm, file, bot gửi, sai chat hoặc sai người gửi bị bỏ qua. Các update text hỏng schema báo lỗi giao thức. Tin nhắn người dùng vẫn là dữ liệu ngoài hệ thống. Adapter không mở cổng vào, gọi Bot API thực thi tác vụ, trả lời, tải media hay nhập dữ liệu vào AI Twin. Event `message.unsupported.received` có thể là chủ đích bảo vệ người gửi của nền tảng. [Webhook và loại sự kiện](https://bot.zapps.me/docs/webhook/)

Cấp quyền chọn thời hạn lưu 1–365 ngày. Thu hồi xóa dữ liệu của grant, một hội thoại hoặc cả tài khoản. Xóa một khoảng thời gian đặt dấu chặn theo thời gian đến khi hết hạn lưu, để replay trong grant cũ không phục hồi nội dung. Đọc, ghi và `purgeExpired()` dọn các bản ghi hết hạn. Host thử nghiệm cần chủ động gọi phương thức dọn nếu không có lưu lượng. Chỉ đưa đường dẫn và DatabaseSync fixture cho mã này. Việc tích hợp với thư mục dữ liệu thật, sao lưu và xóa trên thiết bị thật chưa được kiểm chứng.

Coverage trả số tin đang còn quyền đọc, thời điểm tin đầu/cuối, lần poll thành công gần nhất và tối đa 50 khoảng trống gần nhất còn trong thời hạn lưu. Kết quả luôn đánh dấu lịch sử có thể thiếu. Fixture dùng tệp SQLite tạm, đóng và mở lại kết nối để kiểm tra restart, cùng hai kết nối riêng để kiểm tra thu hồi và fencing.

## Trạng thái phát hành

| Hạng mục | Bằng chứng | Quyết định |
|---|---|---|
| Probe và chuẩn hóa private text | Unit fixture chạy trên Node | GO cho nghiên cứu nội bộ |
| Định danh ngoài hệ thống, ghép cặp, vault desktop và sink ghi bền | Chưa có smoke Zalo thật từ đầu đến cuối | NO-GO cho khách hàng |
| Polling nhiều runtime | Hai kết nối cùng tệp SQLite được kiểm tra bằng lease và epoch. Nhiều máy dùng các tệp riêng và service bên ngoài vẫn có thể tranh chấp; Zalo khuyến nghị webhook cho production | NO-GO cho nhiều máy |
| Gửi tin, thông báo, giao việc qua Official Bot | Chưa có receipt, chính sách phê duyệt gửi, pairing và kiểm chứng máy đích trong luồng này | NO-GO |
| Webhook production | Cần ingress HTTPS, xác thực X-Bot-Api-Secret-Token trước khi đọc body và lưu bền trước ACK | NO-GO |

Zalo công bố cả API gửi file và giới hạn độ dài tin văn bản. Quyền gửi, quota, loại tệp, kênh đích và biên nhận cần được xác minh trên bot thử trước khi quảng bá cho người dùng. [sendFile](https://bot.zapps.me/docs/apis/sendFile/) · [sendMessage](https://bot.zapps.me/docs/apis/sendMessage/) · [bảng mã lỗi](https://bot.zapps.me/docs/error-code/)

Rollback bằng cách gỡ flag khỏi môi trường trước khi khởi chạy. Không có migration dữ liệu, thay đổi cấu hình webhook hay dịch vụ polling nền. Thay đổi ở Zalo Official không ảnh hưởng đường khởi động của StartupBot.
