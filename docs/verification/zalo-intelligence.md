# Zalo Intelligence trong StartupBot

## A. Đối chiếu nguồn và quyết định

Mốc đối chiếu StartupBot là `499e9db515bbcf0d6c4f0a916f53e0b71014be77`. OpenClaw main tại lần đọc là `aa4a68f4cf4b946cbfe8f3b65c285e74ddd5dbbb`. Mốc để tái lập adapter là bản ổn định `v2026.11.10` / `6ea542fd97e2876aa4c871ccc494ed5419a03c5c`. Plugin `@openclaw/zalouser` cùng phiên bản. Manifest và importer/snapshot trong lockfile cùng chọn zca-js **2.2.0**, dù bản phát hành zca-js mới hơn là 2.4.0. [Manifest](https://github.com/openclaw/openclaw/blob/6ea542fd97e2876aa4c871ccc494ed5419a03c5c/extensions/zalouser/package.json) · [Lockfile](https://github.com/openclaw/openclaw/blob/6ea542fd97e2876aa4c871ccc494ed5419a03c5c/pnpm-lock.yaml) · [SDK đúng tag](https://github.com/RFS-ADRENO/zca-js/tree/dadfef18bcac53537741855c99f084152da1fad9)

| Chức năng | OpenClaw | StartupBot trước thay đổi | Khoảng trống và quyết định | Bằng chứng mã nguồn |
|---|---|---|---|---|
| Zalo cá nhân | QR, profile, listener, group policy, danh bạ, nhận/gửi, media | Chưa tìm thấy adapter ở main | Viết adapter đọc text nội bộ, chỉ dùng SDK trực tiếp trong phòng thử | OpenClaw zalouser/src/zalo-js.ts, zca-client.ts, group-policy.ts; scripts/qualification/zalo-personal |
| Bot chính thức | Polling hoặc webhook, pairing, kiểm quyền, send | Ghép cặp di động, auth và route dành cho các loại người dùng StartupBot | Tách token bot, kiểm danh tính và trạng thái webhook, kiểm sender và chat trong fixture | OpenClaw zalo/src/monitor.ts, monitor.webhook.ts; server/request-auth.ts, server/zalo-official.ts |
| Kênh giao tiếp | SDK kênh, nhiều connector | Team Slack và bridge Teams, inbox cá nhân, room, mobile | Không ánh xạ sender Zalo thành owner, không đẩy chat vào luồng điều khiển máy | server/team-slack.ts, deploy/teams/bridge.py, server/routes/channels.ts |
| Trùng, restart, mất dữ liệu | Durable ingress, lane theo nhóm, retry giới hạn | Queue và receipt gắn với thread/tác vụ | Tái sử dụng SQLite runtime. Bảng fixture riêng theo consent để tránh ghi chat riêng vào DB transcript mặc định | zalouser/src/ingress.ts, server/message-db.ts, server/zalo-inbox.ts |
| Credential | Theo profile, cập nhật và xóa phiên | Electron safeStorage, private desktop owner, pairing | Probe Official chỉ giữ token trong request. Personal thử ranh giới vault. Chưa cấp quyền lưu session khách hàng | electron/secure-credentials.mjs, server/routes/zalo-official.ts |
| Browser | Không cần browser cho luồng SDK | Chrome/CDP, browser bundle, Computer Use và Saved Steps | Dùng Chrome có sẵn trên trang chat tổng hợp; không thêm Chromium/Playwright vào installer | scripts/prepare-browser.mjs, server/saved-steps, scripts/qualification/zalo-personal/bench.mjs |
| AI và chi phí | Agent theo cấu hình OpenClaw | Model routing, text writer, AI Wallet và OpenRouter hiện có | Dùng writer tạo bản xem trước. Chỉ model đã được runtime cấp writer mới dùng được. Báo cáo từ khóa chạy ngay trên máy | server/side-jobs.ts, server/ai-twin-preview.ts |
| Phong cách và kiến thức | Cần đối chiếu từng cấu hình ngoài hai extension | AI Twin, trang kiến thức đã duyệt và kiểm tra nguồn | Dùng bản nháp có đồng ý theo từng dòng và tra cứu riêng trong Second Brain. Không tự học từ người nhắn | src/components/AiTwinPreview.tsx, src/components/knowledge/BrainDialog.tsx |
| Công việc | Các extension định tuyến tới agent | Routine, Today, Workflow/Saved Steps, catalog skill | Mở trình soạn Routine với lời nhắc cố định để người dùng xác nhận. Giữ thao tác ghi sổ và chạy workflow ngoài dữ liệu tin nhắn | src/components/RoutineCalendarPage.tsx, server/routes/today.ts, skills/zalo-* |

Các PR #123 và #135 đã bổ sung AI Twin và giới hạn truy xuất memory. Ở thời điểm bắt đầu, #131 xử lý desktop handoff, #132–134 đang thay đổi quyền/bằng chứng và đánh giá memory. Phần Zalo không sửa chính sách cấp quyền của các nhánh đó. Không có phép đo trực tiếp cho các kênh Telegram, WhatsApp, Discord hay upstream MausBot trong đợt thử này.

## B. Ranh giới thiết kế

Bot Token chính thức không phải phiên cá nhân. Tài khoản được xác minh qua getMe độc lập với quyền đọc hội thoại. Trạng thái webhook không xác định chặn polling. Sự kiện chỉ vào inbox khi adapter, account, loại hội thoại, ID hội thoại, sender và grant còn hiệu lực. Cùng event ID nhưng nội dung khác là xung đột cần kiểm tra. Coverage ghi rõ khả năng thiếu dữ liệu. Mất kết nối, lỗi quyền hoặc thu hồi không kích hoạt browser.

SDK Personal có thể trao cookie và danh tính thiết bị, nhận sự kiện ngoài phạm vi, hoặc gửi dưới danh tính chủ tài khoản. Chi phí cấp các quyền đó vào process chính cao hơn nhu cầu của bộ phân tích. Bản lab chạy SDK đã ghim, cấm mạng thật trong worker thử và chỉ trao đổi IPC định kiểu. Không có đường đăng nhập Personal từ bản khách hàng. Cơ chế lấy lịch sử nhóm có trong SDK, từng có báo cáo 404. SDK cũng có báo cáo listener nhận trùng và lỗi sau mất kết nối. Không thể suy ra số tin đã bỏ sót từ một websocket đang mở. [Issue lịch sử nhóm](https://github.com/RFS-ADRENO/zca-js/issues/356) · [Listener trùng](https://github.com/RFS-ADRENO/zca-js/issues/348) · [Health monitor OpenClaw](https://github.com/openclaw/openclaw/issues/181111)

Phân tích trên máy không tạo bản sao tin nhắn trong DB của desktop. Người dùng dán một đoạn, đặt tên nguồn rồi xem kết quả. Mỗi nhận định có số dòng. Đóng hoặc xóa mục rà soát sẽ gỡ dữ liệu khỏi trạng thái giao diện. Điều này không bảo đảm xóa clipboard hệ điều hành hay bản gốc người dùng đã sao chép. Dòng nhập tay không có danh tính sender, thời điểm nền tảng hoặc ID message đáng tin cậy. Hai dòng giống nhau đều được giữ.

## C. Khả năng và giới hạn

- **Nhập tay và phân loại** giới hạn 5.000 dòng, 8.000 ký tự mỗi dòng, 512.000 ký tự mỗi lần. Hỗ trợ bảy dấu hiệu nghiệp vụ và trạng thái chưa phân loại, cùng chỉ báo khẩn. Câu phủ định, tiếng địa phương và nhiều ý trong cùng một câu có thể cho kết quả sai. Kết quả chỉ là đề xuất.
- **AI Twin** dùng riêng dòng người dùng chọn. Tên provider/model được hiển thị trước khi người dùng chọn tạo bản nháp. Không tự đưa lời người khác vào hồ sơ phong cách. Ba recipe nghiệp vụ là bất động sản, kế toán và quản lý. Chúng không được nạp tự động vào luồng agent có công cụ. Chủ desktop chọn recipe từ giao diện xem trước; server chọn đúng nội dung trong catalog theo danh sách cố định.
- **Second Brain** tìm trang liên quan bằng cơ chế tìm kiếm, hiển thị nguồn và thu hồi quyền đã có. Người dùng kiểm tra nguồn trong hộp thoại riêng. Chưa có thử nghiệm đối chứng chứng minh tra cứu này làm tăng độ chính xác của bản nháp Zalo; đoạn nhập tay không tự trở thành kiến thức.
- **Routine** mở trình soạn trong ngữ cảnh bot đã chọn với một lời nhắc cố định và số dòng. Việc lưu lịch cần hành động trong trình soạn. Raw text, tên nguồn nhập tay và lệnh trong tin nhắn không được chuyển thành prompt của Routine. Today tiếp tục báo cáo các lần chạy qua cơ chế sẵn có. Luồng Zalo → thực thi Saved Steps/MISA → trả báo cáo chưa đủ điều kiện.
- **Official** có kiểm tra danh tính. Polling vào inbox đã kiểm thử với fixture, còn pairing người thật, gửi/nhận qua webhook, remote execution và vận hành background chưa được nghiệm thu. **Personal** và **browser** ở phòng thử. [Official](zalo-official.md) · [Personal và browser](zalo-personal.md)

## D. Đo hiệu năng và chất lượng

Môi trường macOS arm64. Bộ dữ liệu tổng hợp có 200 câu gốc khác nhau, gồm 20 câu phát triển, 20 câu giữ riêng và 160 câu bổ sung cân bằng theo tám nhãn. 40 câu đầu còn có năm cách biểu diễn để kiểm Unicode, viết hoa, khoảng trắng và không dấu. Mỗi model chạy thật trên 20 câu giữ riêng và 160 câu bổ sung, mỗi lần một câu, qua Ollama loopback. Chưa có dữ liệu khách hàng hoặc đánh giá độc lập của chuyên gia nghiệp vụ. Chạy `node evals/zalo/evaluate.mjs` trên Node ≥24 để đo quy tắc. Thêm `--ollama` cho Llama hoặc `--ollama --qwen` cho Qwen. Thêm `--validation` để đo model trên 160 câu bổ sung.

| Phương thức và tập | Ý định đúng | Khẩn đúng | Thời gian / token |
|---|---:|---:|---|
| Quy tắc, tập phát triển có biến thể | 100/100 | 100/100 | 0 token |
| Quy tắc, tập giữ riêng có biến thể | 70/100 | 100/100 | 0 token |
| Llama 3.2 3B, 20 câu giữ riêng | 8/20 | 17/20 | 8,65 giây, 1.909 vào / 294 ra |
| Qwen 3.5 9B, 20 câu giữ riêng | 18/20 | 19/20 | 39,03 giây, 1.658 vào / 359 ra |
| Quy tắc, 160 câu bổ sung | 48/160 | 152/160 | 0 token |
| Llama 3.2 3B, 160 câu bổ sung | 59/160 | 141/160 | 83,98 giây, 15.634 vào / 2.688 ra |
| Qwen 3.5 9B, 160 câu bổ sung | 146/160 | 159/160 | 484,51 giây, 13.608 vào / 2.924 ra |

Quy tắc thường trả về “chưa phân loại” khi cách diễn đạt khác mẫu. Llama gán nhầm 18/20 yêu cầu báo giá vào nhu cầu mua. Qwen nhận đúng 13/20 câu về hóa đơn và 15/20 câu thuộc nhóm khác. Kết quả theo nhãn còn quan trọng khi ứng dụng vào kế toán. Tốc độ phụ thuộc tải máy. Chưa đánh giá bản nháp dài hoặc đo egress của toàn hệ điều hành.

Ngoại suy Qwen từ 160 câu, 1.000 tin tương đương khoảng 85.050 token vào và 18.275 token ra. Chi phí API ước tính bằng `0,08505 × giá một triệu token vào + 0,018275 × giá một triệu token ra`. Trên máy thử, 1.000 lần gọi tuần tự tương đương khoảng 50 phút. Thí nghiệm dùng Ollama cục bộ nên phí API thực trả bằng 0. Điện, phần cứng, ngữ cảnh dài, retry, tool và bản nháp có thể làm thay đổi chi phí.

Trong fixture 5.000 tin / 20 nhóm, p50/p95 cho cả lô qua constructor và bộ chuẩn hóa SDK là 1,20/1,83 ms; qua DOM tĩnh và CDP là 27,43/30,46 ms. Chrome khởi động khoảng 1,40 giây. Phép đo không bao gồm lịch sử ảo hóa, mạng Zalo hay tổng RSS của Chrome. Inbox SQLite fixture tệp thật lưu 5.000 event trong 2,854 giây (~1.752/s), p50/p95 ghi 0,487/0,771 ms; tệp 1.609.728 byte, RSS process tăng 29,83 MiB. Các số này không dự báo RAM của Ollama hay chi phí thực tế của người dùng. Chưa đo chạy bền 24 giờ, lỗi ngoài dịch vụ, độ trễ nhận tin thật hay phần chênh installer A/B.

## E. Bảo mật và phát hành

MIT cho OpenClaw và zca-js cho phép tái sử dụng mã theo license. Quyền xử lý hội thoại và quyền truy cập dịch vụ là điều kiện riêng. Một Bot Token xác thực được không cấp quyền vào Zalo Personal, lịch sử tài khoản hoặc chat khách hàng. Môi trường thử dùng tài khoản và sender giả cho các test nhận/gửi. [Điều khoản Bot Platform](https://bot.zapps.me/docs/terms/) · [Điều khoản Zalo](https://zalo.me/zalo/dieukhoan/)

| Rủi ro | Kiểm soát đã triển khai | Phần còn mở |
|---|---|---|
| Tin nhắn giả danh chủ máy, prompt injection | Không route inbound tới tool. UI hiển thị text; editor Routine chỉ nhận lời nhắc cố định. Recipe chỉ đi qua text writer có kiểm tra owner/provider. | Chưa nghiệm thu điều khiển máy từ Zalo, không mở quyền đó. |
| Lẫn account hoặc consent cũ | Grant theo tuple và epoch, kiểm lại ghi/đọc, fencing khi hai runtime tranh listener | Chưa điều phối nhiều máy hoặc failover dịch vụ thật. |
| Lộ credentials hoặc nguồn riêng | Bot probe tạm thời, response no-store, log lỗi theo loại; Personal lab thử vault và IPC; dùng scope sẵn có của Twin/Brain | Vault Personal chưa thử trong bản đóng gói với tài khoản thật; chưa nghiệm thu egress đa nền tảng. |
| Trùng gửi khi mạng đứt | Kiểm thử receipt unknown sau restart; approved-send chỉ có transport tổng hợp | Chưa có đối soát sau gửi thật; không mở gửi khách hàng. |
| Nội dung thu hồi hồi sinh trong backup | Vault/inbox thử nghiệm nằm ngoài backup sản phẩm; xóa theo grant và chặn replay đã kiểm bằng tệp SQLite | Backup/restore DB Zalo thật, attachment/media và migration khách hàng chưa nghiệm thu. |

Rollback bằng cách tắt Official pilot, thu hồi token tại Zalo khi cần và revert giao diện hoặc PR tương ứng. Dữ liệu cá nhân trong SDK lab không tạo migration cho workspace StartupBot. Khôi phục token tại nền tảng là thao tác của chủ tài khoản.

## F. GitHub và tái lập

| PR | Branch | Nội dung |
|---|---|---|
| [#139](https://github.com/tigerthong1102/MoonBot/pull/139) | feat/zalo-transport-qualification | Bot probe, SQLite, SDK worker và benchmark |
| [#140](https://github.com/tigerthong1102/MoonBot/pull/140) | feat/zalo-intelligence | Giao diện, quy trình nghiệp vụ, đánh giá tiếng Việt |
| [#141](https://github.com/tigerthong1102/MoonBot/pull/141) | feat/zalo-official-webhook-pairing | Webhook nội bộ, mã ghép và phê duyệt sender/chat |

Bản app macOS arm64 đóng gói nội bộ đã xử lý ba dòng tổng hợp qua giao diện tiếng Việt. Đã tạo Routine từ dòng đầu và đọc lại qua API. Form xác minh Bot thật, hiển thị trạng thái webhook chưa xác định và xóa ô token. Trong một lượt thử riêng, chủ tài khoản cho phép gửi và nhận trực tiếp trong chat với bot. Zalo trả 408 khi poll rỗng, dù truy vấn thông tin webhook báo 404. Khi long poll đã mở, một mã ngẫu nhiên kèm câu đối soát tổng hợp đến đúng bot, hàm phân loại của sản phẩm nhận diện đối soát và khẩn. Một lần gọi sendMessage trả message_id và đã đọc lại phản hồi trong Zalo Desktop. Công cụ thử chỉ trả lời đúng tin có mã trong chat riêng. Quyết định dừng polling không giám sát khi thiếu trạng thái webhook vẫn áp dụng trong sản phẩm. Chưa kiểm chứng gửi từ bot tới một liên hệ chỉ biết tên hoặc chạy bot thường trực. Kiểm tra gói Windows và Linux thành công trên revision sản phẩm `ec103d183`. [Run Linux](https://github.com/tigerthong1102/MoonBot/actions/runs/46122266615) · [Run Windows](https://github.com/tigerthong1102/MoonBot/actions/runs/46122268629)

## G. So sánh và quyết định

OpenClaw có luồng QR, listener, nhóm, media và gửi tin rộng hơn. StartupBot hiện kiểm chứng được phân tích tiếng Việt trên đoạn nhập tay, còn khả năng cài đặt/kết nối nhanh hơn chưa có phép đo với người dùng mới. Thí nghiệm tám câu chính sách giả lập dùng hàm tìm kiếm Second Brain thật và hàm soạn AI Twin với Qwen 9B. Tìm đúng trang đầu 8/8. Khi harness chuyển trích dẫn thành bài học đã duyệt, bản nháp chứa dữ kiện đúng 8/8, so với 0/8 khi thiếu dữ kiện. Với yêu cầu phong cách rõ ràng, 8/8 dùng lời chào yêu cầu. Phép thử phối hợp hai thành phần bằng harness. Giao diện vẫn yêu cầu chủ sở hữu xem xét nguồn riêng. Chưa đo giá trị trên khách hàng thật. Việc model Qwen 9B chạy tốt hơn Llama 3B trên dữ liệu tổng hợp chưa đủ để chọn provider cho production.

| Thành phần | Trạng thái | Quyết định |
|---|---|---|
| Manual import, báo cáo từ khóa và bản xem trước | Internal Experimental | GO cho kiểm thử nội bộ với dữ liệu có quyền |
| AI Twin, Second Brain và Routine từ dòng đã chọn | Internal Experimental | GO cho luồng xem xét; đo độ chính xác, chi phí, động tác lưu và quyền trước pilot |
| Bot chính thức | Xác minh được danh tính trên dịch vụ thật | GO cho kiểm thử hai chiều có người vận hành trong chat riêng đã xác minh. Chưa nghiệm thu chatbot chạy thường trực hoặc thực thi việc từ xa |
| zca-js | Bản phù hợp để nghiên cứu tương thích OpenClaw | GO cho fixture; NO-GO cho khách hàng và tài khoản cá nhân thật |
| Browser | Research | GO cho DOM fixture; NO-GO cho fallback trên Zalo thật |
| Gửi tin, auto-reply, tự học, background sync toàn bộ | Chưa nghiệm thu | NO-GO |

Các điều kiện còn thiếu của đặc tả 43 mục bao gồm thử đủ A–R trên các cách kết nối thực, duyệt pháp lý cho từng phương thức, QR thành công trên tài khoản được phép, chứng minh phân quyền và xóa xuyên suốt qua backup, đánh giá nghiệp vụ trên tin thật có quyền, so sánh tỷ lệ hoàn thành với người dùng mới và thời gian vận hành dài. Không đưa ra kết luận phát hành thương mại từ fixture.
