# StartupBot Mobile Standalone — báo cáo cho founder

Ngày 28/11/2026. Phạm vi gồm năm draft PR. PR #128 bổ sung quản lý phiên và kiểm soát chi phí sau lần đọc lại toàn bộ đặc tả. [Đối chiếu đủ 36 mục, 128 ca A–L và Definition of Done](mobile-standalone-requirements.md). **GO cho kiểm thử nội bộ bằng dữ liệu giả. NO-GO cho public beta và production.** Người dùng trên bản phát hành hiện tại chưa nhận được thay đổi.

## A. Người dùng làm được gì?

Trong pilot được cấu hình, người mới có bốn bước để nhận câu trả lời đầu tiên: mở **Chat không cần máy tính**, nhập email, xác nhận OTP, nhập tin nhắn và đồng ý lưu hội thoại rồi gửi. Không cần API key nếu tài khoản có credit hoặc được nhận một suất dùng thử. Không có Desktop, Cloud Agent hay VM riêng trong luồng này. Điện thoại cần Internet đến backend dùng chung. Thời gian người dùng thật chờ email và câu trả lời đầu tiên chưa đo.

Chat hỗ trợ hiển thị text ngay khi provider phát, Dừng, lịch sử, đặt tên, xóa, đổi hội thoại, sao chép, code fence và một số định dạng Markdown. Có thể dịch, tóm tắt, soạn thảo, lập kế hoạch chiến dịch và soạn email tiếp cận. Hai chức năng sau dùng phần hướng dẫn văn bản trong catalog có sẵn. Giao diện không gửi email, đọc MISA hoặc chạy một chương trình. Tác vụ máy tính được tách bằng lựa chọn trong UI và một số mẫu yêu cầu trực tiếp. Các câu tự nhiên khác dựa vào câu trả lời hướng dẫn của model; đây chưa phải bộ phân loại tổng quát.

**Đã kiểm chứng** luồng trình duyệt qua gateway đến Better Auth/D1 thật chạy trên máy thử, email đi vào hộp thư local, model trả dữ liệu mô phỏng. Catalog mặc định của pilot chỉ định GPT-4.1 mini. Chưa có inference trả phí hoặc đánh giá chất lượng Anh/Việt của model thật. Đăng nhập có email OTP. Kết nối OpenRouter là lựa chọn bên chi trả, không thay đổi tài khoản StartupBot. Người dùng có thể xem các máy đã đăng ký, sau đó ghép đôi theo giao thức native riêng. [Ảnh Chrome 390 × 844, tiếng Việt, dữ liệu fixture](assets/mobile-standalone-fixture-vi.png)

## B. Thay đổi so với main

| Phần | Trước | Bản thử nghiệm |
|---|---|---|
| Tài khoản | Better Auth/D1 và email OTP đã có ở control plane. | Mobile dùng lại cùng issuer và ID bất biến; phiên browser có expiry, logout, kiểm tra lại issuer. |
| Điện thoại | Có thể bỏ qua ghép đôi nhưng chat tác vụ cần harness/host. | Có entry ở Welcome, màn hình chưa ghép đôi và Settings; Safari trong app/Android Custom Tabs mở cùng giao diện HTTPS. Build thiếu origin vẫn dùng onboarding cũ. |
| Desktop/Cloud | History, pairing, quyền tool, thiết bị và server có trước. | Chat standalone không có đường thực thi lệnh. Registry chỉ đọc trả tên, nền tảng và phiên bản. Pairing và phê duyệt hành động vẫn ở companion. |
| AI và skill | Gateway OpenRouter/ví sandbox đã có; SSE bên ví đợi cả JSON. | Đường mới tiêu thụ từng chunk thật, giới hạn context và output, chọn skill từ allowlist, hỗ trợ credit StartupBot hoặc BYOK phiên riêng. |
| Dữ liệu và quyền | Desktop local-first; Inbox có room, file và bot riêng. | Lưu hội thoại Mobile sau consent, chỉ truy vấn theo owner. Tối đa 50 hội thoại × 80 lượt; lịch sử phân trang 12 lượt, đọc context tối đa 8 cặp, 16 KiB gồm prompt hiện tại, ngoài system instruction. Không tự import lịch sử Desktop hay file. |
| Tiền và vận hành | Hold trên số dư một user, sandbox Stripe, đối soát generation. | Thêm giới hạn toàn dịch vụ theo ngày/tháng UTC, tốc độ và concurrency theo user, tùy chọn trial giới hạn cohort, kill switch và CLI budget-status. BYOK có sổ riêng. |
| Duy trì | Hai client native và một gateway. | Thêm một bề mặt web vào cùng gateway và hai điểm vào native; không thêm dịch vụ triển khai bắt buộc. Cần vận hành TLS, volume/backup, issuer email và quản trị provider. |

## C. Bằng chứng triển khai

| Dependency | Branch và commit mã đã kiểm tra | PR và CI |
|---|---|---|
| 1. Tài khoản, gateway, chat | `feat/mobile-independent-chat` · `c9ac5d336` | [PR #124](https://github.com/tigerthong1102/MoonBot/pull/124) · [CI](https://github.com/tigerthong1102/MoonBot/actions/runs/46092081606) |
| 2. Native, dựa trên 1 | `feat/mobile-native-account-entry` · `52ac916ce` | [PR #125](https://github.com/tigerthong1102/MoonBot/pull/125) · [Native CI](https://github.com/tigerthong1102/MoonBot/actions/runs/46090251617) |
| 3. OpenRouter cá nhân, dựa trên 2 | `feat/mobile-openrouter-connection` · `cd9d821ec` | [PR #126](https://github.com/tigerthong1102/MoonBot/pull/126) · [CI](https://github.com/tigerthong1102/MoonBot/actions/runs/46090749139) |
| 4. Ngân sách, catalog, registry và báo cáo, dựa trên 3 | `perf/mobile-managed-budget-admission` · `d32095798` đến `1902f5375`, tích hợp bản sửa test ở `dea4a2d2c` | [PR #127](https://github.com/tigerthong1102/MoonBot/pull/127) · [Trạng thái CI hiện tại](https://github.com/tigerthong1102/MoonBot/pull/127/checks) |
| 5. Quản lý phiên và kiểm soát, dựa trên 4 | `feat/mobile-account-controls` · `abfce8c0e` | [PR #128](https://github.com/tigerthong1102/MoonBot/pull/128) · [CI](https://github.com/tigerthong1102/MoonBot/pull/128/checks) |

Base là `3d35516862f78414208146c1fd3f766af0e845e2`. Các mô-đun chính là `apps/ai-pilot/mobile*.{mjs,js,html}`, `managed-budget.mjs`, `ledger.mjs`, `router.mjs`, `electron/control-plane-client.mjs`, `ios/App/MobileChatButton.swift` và `MobileChatButton.kt` trong Android UI. Các skill dùng nguyên nguồn đã có trong `skills/catalog/campaign-plan` và `skills/catalog/draft-outreach`, có LICENSE và SOURCE.md. [Đánh giá kiến trúc](../architecture/mobile-standalone-assessment.md) · [Cấu hình, đối soát và rollback](../../apps/ai-pilot/README.md)

## D. Kiểm thử và giới hạn bằng chứng

| Loại bằng chứng | Kết quả và môi trường |
|---|---|
| Unit/integration có đếm | **2.486 PASS, 0 FAIL, 13 SKIP** trên macOS arm64, Node 26.4.0. Bảy suite gateway/ví/PKCE/quota/client/i18n/Desktop gồm **69 PASS**. Toàn bộ Worker workerd/D1 có **230 PASS** trên 11 suite. Electron có **2.187 PASS, 13 SKIP** trên 2.200 case. Baseline 17/17 là lượt riêng. |
| Browser HTTPS end-to-end | Chrome thật, viewport mobile, issuer chạy local với 18 D1 migrations, OTP từ email sink. Đăng ký mới → suất trial → xác nhận registry trống → nhận stream → reload history → logout; issuer trả 200, dùng lại chính bearer cũ trả 401. Một lượt khác kiểm tra desktop-required. Ở chiều rộng 320 px, dark mode và font 125%, trang không tràn ngang. Provider inference là fixture. |
| Browser BYOK | Chrome + issuer local; mô phỏng trang authorize và exchange của OpenRouter. Callback S256, gửi bằng personal key; sau disconnect, gửi lại bị từ chối. Từ chối cấp quyền ở provider rồi mở chat mới vẫn gửi được. Tests kiểm tra khác phiên, state một lần, race, key hash và giới hạn chi phí. |
| Desktop | Harness cô lập, doctor không có problem. Tạo bot, gửi, chờ và đọc lại câu trả lời fake engine. Đây là luồng server trên macOS. Chưa kiểm thử phiên bản đóng gói mới trên macOS, Windows hoặc Linux bằng máy người dùng thật. |
| Migration/rollback | Ledger tạo từ mã base, có token, user và top-up. Mở bằng lớp mới và bật schema Mobile, sau đó mở lại bằng binary logic cũ: token và số dư được bảo toàn. Tests riêng chứng minh backfill chỉ một lần, rollback transaction, settle lặp, hold đi qua ranh giới tháng. Chặn inference ở ingress khi rollback sang bản thiếu cap; chưa diễn tập disaster recovery trên volume thật. |
| Native | Android CI đã build preview, chạy core và test onboarding/notification, kiểm tra intent HTTPS. Trên iPhone simulator, 26 AppTests và một XCUITest đạt. Cả hai job chạy thành công trên commit `52ac916ce`; Android không công bố số case riêng trong log. [Native CI](https://github.com/tigerthong1102/MoonBot/actions/runs/46090251617) Local `swift build --package-path ios` thành công với CompanionCore và Swift parse thành công cho phần UI. `swift test` local không biên dịch test do Command Line Tools thiếu XCTest; không có local simulator/JDK/Android SDK. |
| Tải | 128/128 HTTP stream hoàn tất, 32 account đồng thời, 4 lượt/account, DB file tạm và provider giả. Một lượt sau tối ưu: 320 ms tổng, P50/P95 tới delta đầu 49/71 ms, P95 hoàn tất 71 ms. Provider thật, WAN và điều kiện nền iOS/Android chưa đo. |
| DB có lịch sử | 3 triệu dòng settled trên SQLite in-memory một writer ở macOS. 5 lần admission trước là 871–901 ms, sau là 0,047–0,844 ms. Một lượt đo độc lập chỉ tính phần truy vấn cho kết quả 948–1.328 ms và 0,083–0,148 ms tương ứng. [Benchmark tái lập](../../scripts/testing/mobile-budget-benchmark.mjs). Các số này chưa đại diện IOPS volume, HA hay 100.000 phiên đồng thời. |
| Kiểm tra tĩnh | Build TypeScript/Vite thành công trên macOS, có cảnh báo bundle lớn hơn 500 kB. Typecheck, kiểm tra cú pháp của 481 Electron module, lint và `git diff --check` đều đạt. Ảnh trong báo cáo là ảnh màn hình của fixture. Chưa tạo gói ký để phát cho khách hoặc gửi store. |

Đếm theo **nhóm nghiệm thu riêng**, ở vòng ban đầu, trước khi đối chiếu từng ca ở PR #128: BLOCKED 4 nhóm gồm email Internet + AI có chi phí trong staging, cấp/thu hồi khóa OpenRouter thật, iPhone vật lý, Android vật lý. NOT RUN 6 nhóm gồm Wi-Fi↔4G/5G và app bị OS đóng, VoiceOver/TalkBack trên hardware, khôi phục backup đã mã hóa trên hạ tầng đích, thanh toán và restore purchase trên store, E2E đọc/chạy MISA qua handoff, tải qua nhiều vùng với provider thật. Các nhóm này bao quát nhiều case; không có số test riêng lẻ đáng tin cho phần chưa chạy. Lỗi logout 415 đã được tái kiểm tra sau khi sửa. CI Windows từng hết 20 giây chờ server khởi động trước khi chạy bốn assertion Desktop. PR #124 dùng chung timeout theo nền tảng đã có trong repo. Bốn case chạy đạt trên macOS. Theo dõi kết quả Windows mới tại [CI #124](https://github.com/tigerthong1102/MoonBot/actions/runs/46092081606).

## E. Bảo mật, tính tương thích và quyền riêng tư

**Các lỗi đã sửa khi review.** Hai lỗi mức cao ảnh hưởng đến chi phí: mất response ban đầu có thể tạo lượt tính phí trùng khi gửi lại; ngắt mạng trong lúc issuer đang xác minh có thể khiến gateway gửi inference sau khi người dùng đã bấm Dừng. Đã giữ request ID cho cùng draft, tra lại lịch sử, kiểm connection trước khi dispatch và giữ khoản tiền chưa rõ kết quả. Lỗi logout được xác minh ngoài mock. Lỗi trạng thái/UX đã sửa gồm khóa slot sau khi cancel và biến một lỗi mạng thành sign-out. Với BYOK, đã chặn callback khác session, callback phát lại, việc đổi khóa âm thầm trong cùng thread và việc giữ toàn bộ hạn mức cá nhân vô thời hạn qua ngày mới.

| Rủi ro còn lại | Tác động | Cổng xử lý |
|---|---|---|
| Tốc độ OTP dùng chung IP egress của gateway | Cao cho rollout đông người; upstream còn giới hạn theo recipient và IP. | Đo và thay luồng issuer cho mật độ thật, giữ chống lạm dụng. Không mở guest hoặc bỏ giới hạn. |
| Email bị chiếm, nội dung nhạy cảm trong transcript/provider | Cao cho dữ liệu khách hàng. Người kiểm soát email có thể truy cập chat đã lưu. | Chỉ dữ liệu thử; trước beta cần retention, encrypted volume/backup, quy trình xóa account, chính sách provider và recovery. Delete thread chỉ xử lý DB hoạt động. |
| Store và billing | Cao cho phát hành. Ví Stripe đang ở test mode. | Xác nhận cơ chế xử lý account deletion và mua hàng theo từng storefront. [Apple account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/) · [Google Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) |
| Chi phí upstream chưa rõ sau timeout hoặc key provisioning | Có thể giữ credit lâu hơn dự kiến, hoặc phát sinh lỗi đối soát. | Theo dõi hold/generation và Activity, khóa riêng có hạn mức, không tự phát lại, không tự nạp tiền. Kill switch dừng lượt mới. |
| Prompt nhúng lệnh trong văn bản | Có thể gây câu trả lời sai. Đường mobile không có tool, cầu Desktop, file parser hoặc chức năng gửi mail. | Đánh giá chất lượng trên bộ câu thật được phép trước khi bán workflow; mọi thao tác Desktop phải qua quyền/approval native. |
| Sự cố SQLite/region và chuỗi cung ứng | Một writer/volume là điểm phụ thuộc. | Đo fsync, migration, backup, restore và peak auth/stream. Trước multi-replica phải chia sẻ authority cho tiền, idempotency và lịch sử. |

**Dependency audit.** `pnpm audit --prod` kiểm tra 829 dependency và trả mã 1 với 0 critical, 2 high, 12 moderate và 2 low. Hai cảnh báo high thuộc source-map-js và Vite. Lockfile ở base và nhánh có cùng Git blob `9f174c356`; stack Mobile không đổi manifest npm hoặc thêm package. Trước khi phát hành, cần cập nhật và kiểm thử các gói bị ảnh hưởng ở cấp repo. Quét phần diff mới theo mẫu private key, GitHub token, model key và AWS access key cho 0 kết quả; phép quét giới hạn ở các mẫu trên. [Advisory source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) · [Advisory Vite](https://github.com/advisories/GHSA-587h-7wmj-h5pm)

Cookie host-only, Secure, HttpOnly và SameSite=Strict chỉ mang secret phiên. Bearer issuer và key cá nhân được mã hóa tại DB bằng secret của phiên. Mọi request dữ liệu kiểm lại issuer, ID không lấy từ email hoặc dữ liệu client. Khóa cá nhân không ghi ra frontend, không đồng bộ sang thiết bị khác. BYOK không tự dùng ví chung. Native app không tự cấp quyền máy tính. Local-only Desktop chưa được chứng nhận bằng kiểm toán network trên tất cả nền tảng.

## F. Chi phí và quy mô

Giá kiểm tra từ OpenRouter cho GPT-4.1 mini là $0,40/triệu token vào và $1,60/triệu token ra. Các mức routing 1/4 USD trong catalog là **giá trần chính sách**. Chi phí chạy model thật trong thử nghiệm này bằng 0. Số tiền dưới đây là mô phỏng, không phải giá bán hay hóa đơn. [Giá model](https://openrouter.ai/openai/gpt-4.1-mini) · [Script tái tính](../../scripts/testing/mobile-cost-simulation.mjs)

Kịch bản cơ sở giả định mỗi MAU có 30 request/tháng, 1.000 token vào + 250 ra/request, 0 reasoning token, 80% managed, 20% BYOK. Một người dùng managed tốn $0,024/tháng cho inference mẫu. Giả định 3% trả $3/tháng, phí thanh toán 4% + $0,30/giao dịch; chưa gồm thuế, phí store, phụ phí nạp provider, hỗ trợ khách hàng hay lương founder. Compute giả định $15 + $0,002/MAU, DB $5 + $0,001/MAU; 8 KB lưu/lượt × 3 tháng, storage $0,03/GB-tháng, egress 10 KB/lượt × $0,10/GB. File upload bằng 0. Ba tháng là giả định dung lượng, chưa phải tính năng tự xóa. Hóa đơn hạ tầng, email, backup, số người trả tiền và retention thật chưa biết.

| MAU | Managed AI | BYOK do user trả | Compute + DB | Storage + mạng | Phí thanh toán | Doanh thu | Lãi gộp minh họa |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1.000 | $19,20 | $4,80 | $23 | $0,05 | $12,60 | $90 | $35,15 (39,05%) |
| 10.000 | $192 | $48 | $50 | $0,52 | $126 | $900 | $531,48 (59,05%) |
| 100.000 | $1.920 | $480 | $320 | $5,16 | $1.260 | $9.000 | $5.494,84 (61,05%) |
| 1.000.000 | $19.200 | $4.800 | $3.020 | $51,60 | $12.600 | $90.000 | $55.128,40 (61,25%) |

**Kịch bản xấu.** Nếu mọi người dùng đều miễn phí, dùng managed, mỗi lượt gửi 10.000 token vào/1.000 ra theo trần 1/4, nhu cầu inference chưa chặn là $420, $4.200, $42.000 và $420.000/tháng tương ứng bốn quy mô. Hạn mức dịch vụ và credit từng người ngừng nhận lượt khi hết ngân sách. Nếu provider báo chi phí bất thường, cần hạn mức ở nhà cung cấp và đối soát. Không có tool loop 20 lượt trong chat này. Model reasoning, vision và file sẽ cần ngân sách riêng trước khi bật.

**Kịch bản tốt.** Giữ mức sử dụng, phí và giá minh họa như kịch bản cơ sở, giả định 60% managed, 40% BYOK và 5% trả phí. Script tính lãi gộp tháng lần lượt $91,55, $1.095,48, $11.134,84 và $111.528,40 ở bốn quy mô. Đây là độ nhạy theo giả định. Nếu nhu cầu dùng lại và chuyển đổi trả tiền cao hơn giả định, hoặc nhiều người tự chi trả BYOK, chi phí managed mỗi MAU sẽ giảm ở cùng mức sử dụng. Chưa có cohort đủ để gán xác suất hay dự báo tăng trưởng. Ngân sách $50/$100/$500 sau $20 chi phí nền minh họa phục vụ khoảng **1.108/2.957/17.743 người miễn phí** theo giả định ngắn ở trên, trước phí chưa biết. Trial có trần theo credit, số tài khoản và ngày hết hạn. Ngưỡng cảnh báo ở 80%, mức nghiêm trọng ở 95%; `budget-status` cung cấp số liệu và tuổi các hold.

100.000 MAU ở 30 lượt/tháng tương đương khoảng 1,16 lượt/giây **trung bình** trong tháng 30 ngày, 1 triệu MAU khoảng 11,57. Tải đỉnh, số stream mở, round-trip issuer/D1, độ trễ model và thông lượng ghi SQLite mới quyết định năng lực triển khai. Tại 1 triệu MAU, giả định lưu trữ tạo khoảng 720 GB transcript trước index/backup. Chưa có cơ sở công bố SLO hay capacity production. Mục tiêu pilot: đo P95 từ bấm Gửi đến delta đầu và thời gian kết thúc, đồng thời tách RTT issuer/provider; mỗi lần replay cùng ID có tối đa một generation bị tính tiền. Theo dõi tỷ lệ nhận phản hồi đầu, trở lại ngày 7, số lần chủ động mở pairing và lần ghép đôi thành công; chưa thu thập telemetry nội dung hay đưa ra tỷ lệ chuyển đổi.

## G. Quyết định cần founder

1. Cho phép một ngân sách thử nhỏ và cấp quyền vào **staging** với issuer/email, domain TLS, workspace provider có giới hạn và test accounts. Việc này mới cho phép đo email thật, token thật, chất lượng model và thu hồi upstream thật.
2. Chọn chính sách lưu/xóa dữ liệu, quyền dùng dữ liệu doanh nghiệp, thị trường phát hành và giá bán/entitlement. Store review, hóa đơn, chi phí thanh toán và bảo vệ dữ liệu phụ thuộc những lựa chọn đó.
3. Cung cấp quyền chạy trên iPhone/Android thật với dữ liệu thử nếu muốn nghiệm thu thiết bị; chỉ phê duyệt phát hành sau khi xong các điều kiện dưới đây. ChatGPT identity và subscription sharing cần xác nhận đối tác cùng scope riêng. Anthropic giới hạn dùng OAuth thuê bao trong ứng dụng bên thứ ba. [OpenAI partner sign-in](https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt) · [Claude usage terms](https://code.claude.com/docs/en/legal-and-compliance)

## H. Trạng thái theo phạm vi

| Trạng thái | Hạng mục |
|---|---|
| COMPLETE trong fixture | Email OTP, tài khoản chung, session và logout/issuer revocation, admission/kill switch, Managed AI với provider giả, stream tăng dần, cancel, idempotency, lịch sử cùng owner, text skills, kiểm soát payer và migration sổ cái. |
| PARTIAL | Mobile native có điểm vào thật; chưa nghiệm thu hardware. BYOK/PKCE có luồng kỹ thuật và smoke giả provider. Registry chỉ liệt kê thiết bị; handoff Desktop là thao tác ghép đôi chủ động. Sync giới hạn ở chat standalone đã đồng ý lưu. |
| BLOCKED cho live | Email và inference được phê duyệt ngân sách, activity/cost readback OpenRouter, phê duyệt ChatGPT partner, kiểm thử thiết bị và store. |
| NOT STARTED | Xóa account toàn hệ sinh thái với retention tài chính, SSO Apple/Google, production billing/store restore, shared worker đa vùng, analytics cohort production. |
| DEFERRED | Mobile Local AI, handoff tự động, deferred task có TTL/approval, file/MISA/Excel trên cloud, push riêng cho chat standalone, selective sync Desktop. |
| NOT RECOMMENDED trong pilot | VM Cloud Agent cho từng user, miễn phí vô hạn, tự chuyển local/BYOK sang managed, biến thuê bao Claude cá nhân thành backend. |

Lợi thế sản phẩm cần kiểm chứng là từ một bản nháp hay kế hoạch có thể đi tiếp sang workflow Desktop đã được người dùng cấp quyền. Một màn hình chat đơn thuần chưa chứng minh được lợi thế thị trường. Hai skill catalog là nơi phù hợp để đo giá trị ban đầu. Trước khi thêm orchestration mới, đo xem người dùng có quay lại để chỉnh nội dung và có ghép đôi nhằm làm tiếp trên máy tính hay không.

Local AI là một runtime khác, cần kiểm tra khả năng thiết bị, RAM, tốc độ, pin, dung lượng model, giấy phép từng bộ trọng số và chất lượng tiếng Việt. Có thể đánh giá Foundation Models trên thiết bị Apple đủ điều kiện và LiteRT-LM trên Android trước khi chọn. Luồng Mobile hiện tại không hứa làm việc offline. [Apple Foundation Models](https://developer.apple.com/documentation/foundationmodels) · [Google LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM)

**GO nội bộ** với dữ liệu giả, hạn mức đã cấu hình và môi trường cô lập. **NO-GO public beta** do thiếu live-provider/thiết bị, xóa account, chính sách dữ liệu và xác minh OTP theo tải. **NO-GO production** cho tới khi vượt các cổng beta, hoàn tất restore/monitoring, đối soát thương mại, kiểm tra toàn bộ CI cần thiết và được founder phê duyệt. Không có thay đổi production hoặc merge vào main trong nhiệm vụ này.

## Kết quả sau khi đọc lại đặc tả

- Mục 7.2 đã có danh sách phiên rút gọn, dấu phiên hiện tại, thu hồi riêng và đăng xuất mọi thiết bị. Worker/D1 thật chạy local đã xác minh thu hồi bearer A và B độc lập. Mobile và ví email cùng ledger thu hồi phiên theo owner. Credential máy và khóa API được cấp độc lập có quy trình thu hồi riêng.
- Mục 11, 16 và 23 bổ sung từ chối runtime chưa được hỗ trợ, tạm ngưng một skill và dừng chi trial đã cấp. Người dùng có thể xem số dư theo chính sách và khoản BYOK đã tính/tạm giữ trong ngày UTC. Tín hiệu registry chưa chứng minh máy đang online.
- Mục 21 và 27 có lượt đo bổ sung 128/128 stream qua HTTP/SQLite fixture, 32 account. Tới delta đầu P50/P95/P99 là 70/88/88 ms; hoàn tất 70/88/91 ms. Thời lượng cả lượt 403 ms. Chưa có inference trả phí hay WAN trong số liệu này.
- Mục 26 được kiểm riêng theo từng ca, gồm cả ca chưa chạy và tính năng hoãn. Ma trận bổ sung ở đầu báo cáo thay cho cách chỉ đếm nhóm. Cổng store bổ sung có báo cáo nội dung ngay trong app ở Play, review native utility, IAP/restore theo thị trường và xóa account. Xem ADR để đối chiếu chính sách chính thức.

**Số ca theo nguyên văn mục 26.** Trong 128 ca, 56 đạt ở phạm vi ghi rõ, 40 đạt một phần, 23 chưa chạy, 5 có blocker và 4 thuộc tính năng hoãn. Một ca có thể cần nhiều test tự động; 2.486 là số test đạt của các lệnh đã chạy. Năm blocker theo ca là tạo tài khoản trên iPhone vật lý, chuyển mạng thật, screen reader, store restore và xóa account xuyên hệ sinh thái.
