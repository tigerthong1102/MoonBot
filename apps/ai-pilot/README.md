# Ví AI nội bộ của StartupBot

Pilot dùng Stripe **test mode** cho gói tháng, năm và credit mua một lần. Mã nguồn không có đường checkout live. Gateway dùng OpenRouter theo từng tài khoản. OpenRouter tính chi phí thật khi quản trị viên tự cấp khóa quản trị và chạy inference. Bộ test dùng nhà cung cấp giả lập, không cần khóa hoặc thẻ.

## Chạy trên máy thử

Dùng Node 24.2 trở lên và một thư mục dữ liệu riêng, bên ngoài repo. Dịch vụ chỉ lắng nghe trên 127.0.0.1. Để thử nhiều máy, chuyển tiếp cổng riêng đến cùng dịch vụ pilot và cùng cơ sở dữ liệu. Chỉ quản trị viên dịch vụ giữ database, các secret và quyền chạy CLI.

```sh
export STARTUPBOT_PILOT_DB=/path/to/private-pilot/wallet.sqlite
export STARTUPBOT_PILOT_CATALOG=/path/to/private-pilot/pricing.json
cp apps/ai-pilot/catalog.example.json "$STARTUPBOT_PILOT_CATALOG"
node apps/ai-pilot/server.mjs issue-token IMMUTABLE_STARTUPBOT_ACCOUNT_ID
node apps/ai-pilot/server.mjs serve
```

Để khách vào ví bằng tài khoản StartupBot, đặt `STARTUPBOT_PILOT_ACCOUNT_ORIGIN` thành origin control plane đã chọn và chạy `node apps/ai-pilot/server.mjs invite ACCOUNT_ID EMAIL`. Khách nhập email trong ví và xác nhận OTP. Gateway kiểm ID bất biến bằng phiên đã ký qua `/v1/me` trước khi tạo phiên ví 8 giờ. Các thiết bị dùng chung số dư của cùng ID. `revoke-token ACCOUNT_ID` thu hồi lời mời, phiên ví và mã engine.

Với fixture ngoại tuyến, cấp token bằng ID tài khoản đã xác minh từ control plane. Cấp lại với cùng ID thay mã cũ, giữ sổ cái và thu hồi mã engine. Gửi mã riêng cho đúng người thử. Ví mở ở `http://127.0.0.1:8537`. Bản build nội bộ có thể đặt `VITE_STARTUPBOT_AI_PILOT=sandbox` để hiện đường vào ví trong Cài đặt → Tài khoản. Bản mặc định ẩn đường này.

Trong ví, khách xem riêng phần còn trong gói, credit mua thêm, ngày hết kỳ, đơn chờ và lịch sử dùng. Để nối vào bot, cấp mã engine từ ví rồi thêm endpoint tương thích OpenAI `http://127.0.0.1:8537/v1` trong **máy chủ StartupBot cá nhân**. Chat, tác vụ và helper dùng endpoint đó tính cho chủ mã. Mã engine chỉ gọi inference và đọc catalog. Trên Team Cloud, engine từ chối lưu mã pilot cá nhân. Người thử dùng giao diện ví theo đăng nhập khi dùng chung máy.

## Đổi giá

Chỉnh bản sao của `catalog.example.json` rồi thay tệp nguyên tử. Dịch vụ đọc lại catalog trên mỗi request. Tăng `version` khi thay báo giá. Mỗi dòng có `amountMinor` là đơn vị tiền nhỏ nhất của Stripe và `creditMicros` là phần triệu USD chi phí inference. Với USD, `900` là 9 USD. Ví dụ năm cấp toàn bộ allowance một lần cho năm đã thanh toán. Credit mua thêm giữ sang kỳ sau. Đổi giá chỉ ảnh hưởng checkout mới. Giá, tiền tệ và quyền sử dụng cho đơn đang chờ và các kỳ gia hạn của thuê bao cũ theo snapshot của đơn ban đầu. Khách có thể tắt gia hạn trong ví.

## Đối soát sandbox

Cấu hình `STRIPE_TEST_KEY` (test secret hoặc restricted test key có quyền tương ứng), `STRIPE_TEST_WEBHOOK_SECRET`, `OPENROUTER_PILOT_MANAGEMENT_KEY` của workspace pilot riêng, `STARTUPBOT_PILOT_ENCRYPTION_KEY` (32 byte ngẫu nhiên mã hóa base64). Giữ nguyên khóa mã hóa giữa các lần khởi động và sao lưu riêng. Chuyển webhook sandbox đến `/stripe/webhook` bằng Stripe CLI `listen --forward-to http://127.0.0.1:8537/stripe/webhook`. Các sự kiện gồm checkout hoàn tất/hết hạn, invoice đã trả, charge hoàn tiền và mở/đóng tranh chấp. Redirect chỉ mở lại ví. Sổ cái đọc lại đối tượng sandbox, đối chiếu đơn và tiền rồi mới cấp quyền. Gia hạn thất bại không mở thêm kỳ. Hết kỳ sẽ tự hết allowance. Khoản hoàn từng phần dựa trên số hoàn tích lũy. Tranh chấp giữ lại phần credit tương ứng số tiền bị tranh chấp. Khi thắng tranh chấp, phần này được trả lại và phần đã hoàn tiền vẫn được trừ.

Trước khi gọi OpenRouter, ví giữ trước chi phí tối đa của request text, bao gồm schema tool và output. Hạn mức routing tính theo USD trên một triệu token. Dịch vụ dùng phản hồi hoàn chỉnh từ OpenRouter trước khi trả JSON hoặc SSE cho client. Nếu mất kết quả, request còn ở trạng thái chờ đối soát sau khi khởi động lại. Không phát lại một request chưa rõ kết quả.

- `reconcile ACCOUNT REQUEST [GENERATION]` đọc cost bằng khóa riêng của user. Với request mất ID, quản trị viên đối chiếu Activity theo key và thời điểm trước khi gắn ID.
- `revoke-token ACCOUNT` vô hiệu hóa cả mã ví và mã engine. Để thu hồi upstream, vô hiệu hóa khóa theo `users.keyHash` trong workspace OpenRouter pilot. Nếu cấp khóa dở dang, tìm đúng tên ngẫu nhiên `users.keyName`, vô hiệu hóa khóa trùng/treo và chỉ sau khi xác minh mới đặt lại trạng thái cấp khóa.
- `keyLimitUsd` là trần chi phí vòng đời riêng cho mỗi khóa tại lúc cấp. Quản trị viên có thể tăng theo hash khi thử nhiều kỳ. Theo dõi số dư quỹ OpenRouter độc lập với số dư của khách.
- Trước khi quyết định bán, đối soát một hóa đơn sandbox, một top-up, một lần hủy/hoàn và một generation thực với nhà cung cấp. Pilot không tự nạp thẻ. Sai khác invoice, checkout không rõ trạng thái quá thời hạn idempotency và chi phí chưa xác định cần quản trị đối soát.

Kiểm thử không ra mạng nhà cung cấp bằng `pnpm exec vitest run scripts/testing/ai-pilot.test.mjs`.
