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

Cấu hình `STRIPE_TEST_KEY` (test secret hoặc restricted test key có quyền tương ứng), `STRIPE_TEST_WEBHOOK_SECRET`, `OPENROUTER_PILOT_MANAGEMENT_KEY` của workspace pilot riêng, `STARTUPBOT_PILOT_ENCRYPTION_KEY` (32 byte ngẫu nhiên mã hóa base64). Giữ nguyên khóa mã hóa giữa các lần khởi động và sao lưu riêng. Chuyển webhook sandbox đến `/stripe/webhook` bằng Stripe CLI `listen --forward-to http://127.0.0.1:8537/stripe/webhook`. Các sự kiện gồm checkout hoàn tất/hết hạn, invoice đã trả, charge hoàn tiền và mở/đóng tranh chấp, và cập nhật/xóa thuê bao (`customer.subscription.updated`, `customer.subscription.deleted`). Redirect chỉ mở lại ví. Sổ cái đọc lại đối tượng sandbox, đối chiếu đơn và tiền rồi mới cấp quyền. Gia hạn thất bại không mở thêm kỳ. Hết kỳ sẽ tự hết allowance. Khi Stripe đang thu lại một kỳ gia hạn thất bại, khách vẫn có thể tắt gia hạn và chỉ mua được thuê bao thay thế sau khi Stripe xác nhận thuê bao cũ đã chấm dứt và phần trong gói đã hết kỳ. Khoản hoàn từng phần dựa trên số hoàn tích lũy. Tranh chấp giữ lại phần credit tương ứng số tiền bị tranh chấp. Khi thắng tranh chấp, phần này được trả lại và phần đã hoàn tiền vẫn được trừ.

Trước khi gọi OpenRouter, ví giữ trước chi phí tối đa của request text, bao gồm schema tool và output. Hạn mức routing tính theo USD trên một triệu token. Dịch vụ dùng phản hồi hoàn chỉnh từ OpenRouter trước khi trả JSON hoặc SSE cho client. Nếu mất kết quả, request còn ở trạng thái chờ đối soát sau khi khởi động lại. Không phát lại một request chưa rõ kết quả.

- `reconcile ACCOUNT REQUEST [GENERATION]` đọc cost bằng khóa riêng của user. Với request mất ID, quản trị viên đối chiếu Activity theo key và thời điểm trước khi gắn ID.
- `revoke-token ACCOUNT` vô hiệu hóa cả mã ví và mã engine. Để thu hồi upstream, vô hiệu hóa khóa theo `users.keyHash` trong workspace OpenRouter pilot. Nếu cấp khóa dở dang, tìm đúng tên ngẫu nhiên `users.keyName`, vô hiệu hóa khóa trùng/treo và chỉ sau khi xác minh mới đặt lại trạng thái cấp khóa.
- `keyLimitUsd` là trần chi phí vòng đời riêng cho mỗi khóa tại lúc cấp. Quản trị viên có thể tăng theo hash khi thử nhiều kỳ. Theo dõi số dư quỹ OpenRouter độc lập với số dư của khách.
- Trước khi quyết định bán, đối soát một hóa đơn sandbox, một top-up, một lần hủy/hoàn và một generation thực với nhà cung cấp. Pilot không tự nạp thẻ. Sai khác invoice, checkout không rõ trạng thái quá thời hạn idempotency và chi phí chưa xác định cần quản trị đối soát.

Kiểm thử không ra mạng nhà cung cấp bằng `pnpm exec vitest run scripts/testing/ai-pilot.test.mjs`.

## Chat Mobile trong môi trường thử

Gateway phục vụ giao diện tài khoản tại `/mobile` khi quản trị cấu hình một HTTPS origin riêng qua `STARTUPBOT_MOBILE_ORIGIN` và issuer qua `STARTUPBOT_PILOT_ACCOUNT_ORIGIN`. Gateway vẫn bind loopback. Chỉ reverse proxy `/mobile` và `/mobile/*` trên origin chuyên dụng, tắt buffering cho stream; giữ riêng ví, engine và webhook. Cookie phiên Mobile chỉ chứa giá trị ngẫu nhiên, khác bearer của issuer. DB lưu hash và bearer mã hóa bằng secret phiên ở trình duyệt. Cookie là Secure, HttpOnly, host-only, SameSite=Strict. Các request ghi cần JSON và đúng Origin. Gateway xác minh bearer qua issuer mỗi request. Issuer được cố định vào DB sau lần bật đầu tiên. Chỉ gắn vào ledger đã thuộc cùng issuer. Kiểm tra bản sao lưu trước khi bật.

Catalog ví cần thêm đối tượng ví dụ bên dưới. Đây là số cho fixture, không phải ngân sách đã duyệt. Chi phí tính bằng phần triệu USD. Thiếu chính sách thì Mobile từ chối inference. Khi gateway bật Mobile, cả đường engine cũ cũng phải có cùng ngân sách. Credit từ payment sandbox/lời mời thử và entitlement của người dùng vẫn độc lập với trần chung. Mặc định đăng ký email mới không tự cấp credit. Có thể chủ động cấp hạn mức thử một lần cho cohort nhỏ bằng cách thêm `"mobileTrial":{"creditMicros":30000,"days":2,"maxAccounts":10}` vào catalog đã bật giới hạn. Ví dụ này cấp tối đa $0,30 danh nghĩa cho toàn cohort. Cấp ở lần gửi đầu tiên của tài khoản đã xác minh, cùng một giao dịch kiểm số chỗ còn lại. Bỏ trường này sẽ dừng cấp mới. Các khoản đã cấp vẫn hết hạn theo ngày ghi trên sổ. Dùng một gateway/ledger với volume bảo vệ và bản sao lưu mã hóa, giới hạn dung lượng, quota email và prepaid workspace có giới hạn nạp riêng. Không dùng nhiều bản sao ledger cho cùng ngân sách.

```json
{"managedLimits":{"enabled":false,"dailyMicros":1000000,"monthlyMicros":2000000,"requestsPerMinute":10,"concurrent":2}}
```

Chuyển `enabled` khi đã cấp ngân sách thử. Thay catalog nguyên tử sẽ ngừng nhận lượt mới ngay. Request đã gửi có thể vẫn tính phí. Sổ cái giữ chi phí chưa rõ qua restart và qua ranh giới ngày/tháng UTC; timeout giải phóng slot chạy riêng. Đối soát qua CLI như phần trên. Lệnh `revoke-token ACCOUNT` cũng đình chỉ admission managed AI. `resume-managed ACCOUNT` mở lại admission cho tài khoản đủ entitlement; các token ví/engine đã thu hồi không được phục hồi. Phiên tài khoản trên điện thoại do control plane quản lý; đăng xuất hủy ngay phiên Mobile và yêu cầu issuer thu hồi bearer. Ngừng inference riêng không xóa lịch sử.

Mỗi lần gửi chỉ dùng một lần inference text, tối đa tám cặp lịch sử gần nhất trong ngân sách byte; không import dữ liệu từ máy tính. Hội thoại được lưu trên gateway khi người dùng xác nhận. Giới hạn 50 hội thoại, mỗi hội thoại 80 lượt. Người dùng có thể xóa từng hội thoại; backup cần thời hạn lưu riêng trước beta. Lịch sử không tự xóa sổ kế toán các lượt dùng. Đường này chưa có quy trình xóa toàn bộ tài khoản/control-plane identity hay payment production.

Dùng `pnpm exec vitest run scripts/testing/mobile-standalone.test.mjs scripts/testing/ai-pilot.test.mjs` và `node scripts/testing/mobile-chat-load.mjs` với DB tạm, OTP/provider giả. Số đo local không bao gồm độ trễ mail, D1 từ xa hoặc upstream thật. Reverse proxy OTP hiện dùng chung IP egress nên giới hạn đăng ký tập thể thấp. Trước beta cần chứng minh lưu lượng đăng nhập qua issuer đáp ứng nhu cầu; không tin header IP do client gửi.

Rollback bằng cách tắt admission, gỡ route thử khỏi proxy và điểm vào native, đợi request đang chạy, sao lưu ledger kèm WAL nhất quán bằng SQLite Backup API. Khi rollback binary, giữ schema bổ sung và đối soát các hold. Bản gateway cũ chưa hiểu global cap/suspension nên phải khóa inference tại ingress đến khi kiểm soát chi phí tương đương được phục hồi.

## OpenRouter của người dùng

Đặt `STARTUPBOT_MOBILE_OPENROUTER_OAUTH=1` trong môi trường thử để hiện mục Nhà cung cấp AI. Mỗi phiên cần người dùng tự chọn kết nối. Gateway dùng callback cố định `/mobile/callback`, state một lần, S256, xác minh phiên và kiểm tra hạn mức còn dương qua API thông tin khóa. Cấu hình reverse proxy phải bỏ toàn bộ query string khỏi access log của callback. Trang callback bỏ mã khỏi URL trước khi xử lý. Không bật trên origin chứa script hoặc analytics bên thứ ba.

Khóa được mã hóa riêng cho phiên và bị xóa khỏi gateway khi ngắt kết nối hoặc dọn phiên hết hạn. Người dùng có thể thu hồi khóa tại OpenRouter theo đường dẫn trong UI, kể cả khi exchange hỏng sau khi nhà cung cấp đã cấp khóa. Hội thoại dùng BYOK được gắn với hash của khóa đã chọn. Đổi payer hoặc dùng khóa khác trên một thiết bị khác cần hội thoại mới. Không chuyển hội thoại dùng khóa cá nhân sang ví StartupBot khi thiếu key hoặc hết credit. Chi phí BYOK được ghi vào bảng riêng; một account được giữ trước tối đa $0,25/ngày và 10 lượt/phút trên đường này. Khi thiếu usage hoặc kết nối gián đoạn, sổ BYOK ghi chi phí chưa xác định và tính toàn bộ dự phòng vào ngày UTC phát sinh. Các ngày sau có hạn mức riêng; đối chiếu generation với Activity của đúng khóa. Giảm thiểu khiếu nại bằng cách thử một kết nối thực có hạn mức, đối chiếu Activity rồi thu hồi key trước beta. Xem [hướng dẫn PKCE chính thức](https://openrouter.ai/docs/guides/overview/auth/oauth) và [điều khoản dịch vụ](https://openrouter.ai/terms).
