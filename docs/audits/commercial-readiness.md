# Điều kiện phân phối thương mại StartupBot Desktop

**NO-GO tại `263a8fa20`.** CI của main đã hoàn thành thành công. Bộ cài nội bộ được kiểm toán ở đây được dựng từ `960b66b33`. Hai SHA có phạm vi bằng chứng khác nhau. Có thể tiếp tục phát triển OSS và thử nghiệm bằng dữ liệu giả. Việc mở bán phụ thuộc vào quyền của từng thành phần phân phối, hoạt động mạng của bản cài cụ thể, bảo vệ dữ liệu và khả năng hỗ trợ những nghiệp vụ ghi trong hợp đồng. [CI main](https://github.com/tigerthong1102/MoonBot/actions/runs/44326874646) · [Bộ cài đã kiểm tra](https://github.com/tigerthong1102/MoonBot/actions/runs/44286893426)

## Quyền mã nguồn và lịch sử

Apache-2.0 cấp quyền sử dụng, sửa và phân phối thương mại đối với tác phẩm thuộc giấy phép đó. Khi phân phối phải kèm giấy phép, duy trì thông báo liên quan, đánh dấu các tệp đã sửa theo điều kiện áp dụng và chuyển tiếp phần NOTICE liên quan. Quyền nhãn hiệu có phạm vi riêng. Nếu mọi thành phần phân phối có quyền độc lập hợp lệ và StartupBot không sử dụng mã/dịch vụ cần hợp đồng Enterprise thì việc thu tiền tự nó không tạo nghĩa vụ mua Enterprise. Kết luận này phụ thuộc vào danh mục vật liệu và hoạt động thực tế. [Apache-2.0, mục 2–4 và 6](https://www.apache.org/licenses/LICENSE-2.0) · [Quy định của dự án](../../LICENSING.md)

- Fork public và commit `b35fe982b` đã xóa 10 tệp trong cây Enterprise. Đã kiểm từng tip nhánh fork sau fetch, kể cả nhánh verification, ASP đóng và các nhánh build. Main không có gitlink/submodule. Lịch sử còn giữ nội dung cũ. Tìm theo tên thư mục và so 26 blob lịch sử riêng biệt dưới đường dẫn enterprise với toàn bộ blob tip và với tệp giải nén là hai phép kiểm khác nhau. Cả hai trả về 0 kết quả trong phạm vi được ghi. Mã đã sửa, dịch, bundle hoặc sao chép một phần cần truy nguồn riêng. [Kết quả theo ref và nền tảng](evidence/enterprise-content.json) · [Commit xóa](https://github.com/tigerthong1102/MoonBot/commit/b35fe982)
- Đề xuất xuất snapshot mới từ allowlist sau khi duyệt nguồn và license của từng tệp/binary. Map digest nguồn → bản sửa → artifact, kèm LICENSE/NOTICE, attribution và thông báo thay đổi. Giữ fork cũ và PR làm chứng cứ tới khi chủ quyền/cố vấn xác nhận cách xử lý công bố trước đây. Việc thay đổi visibility, archive hoặc migration phải do chủ sở hữu quyết định. Một snapshot mới không giải quyết các bản sao lịch sử đã tồn tại.
- GitHub xác định file ảnh được cung cấp, tác giả commit và pipeline sinh ICNS/ICO/PNG. SHA-256 của ảnh nguồn là `50cbd625f00cebbd62a565be45897b1ef0f365a2b12472d298e42faf840bc310`. Chính hồ sơ fork ghi quyền chưa được xác minh độc lập. Chưa tìm thấy văn bản cấp quyền thương mại trong commit thêm ảnh, audit branding hoặc PR desktop đã kiểm tra. Cần căn cứ về tác giả, cấp quyền hoặc chuyển nhượng trước khi duyệt ảnh. [Commit gốc](https://github.com/tigerthong1102/MoonBot/commit/381538951a8249c4633b05f4524fb4165aa85021) · [Hồ sơ branding](../../BRANDING_AUDIT.md)

## Bằng chứng trên bộ cài nội bộ 0.1.161-internal.20261118.11

Đã kiểm SHA-256 của ba installer. DMG được mount read-only. Đã tách gói 7z bên trong Windows NSIS và mở app.asar của cả ba nền tảng. Số tệp đọc gồm tệp thường trong payload ứng dụng và thành viên ASAR. Syft 1.57.2 quét thư mục payload thực, sinh CycloneDX JSON. Syft có giới hạn nhận diện JS đã bundle, asset không có manifest và binary đã strip. Cần ghép nguồn build, license, patch và SBOM con tương ứng trước khi duyệt phát hành.

| Nền tảng | SHA-256 installer | Tệp đã so | Thành phần Syft / thiếu trường licenses | SBOM |
|---|---|---:|---:|---|
| Windows x64 | `d8abaa6cb2f9eba7eac42992ef739b20f800af6ab9b5f00b9faad10c6e7db892` | 3483 | 132 / 131 | [CycloneDX](evidence/internal-960b66b33-windows-x64.cdx.json) |
| macOS arm64 | `01f92a9712030327d329723e1eb5ab8f860006848347ad3a7b639ada712c9325` | 3403 | 79 / 78 | [CycloneDX](evidence/internal-960b66b33-macos-arm64.cdx.json) |
| macOS x64 | `61b065a5ff04337ddb37e62e35a13571341df96df90b946eb97f9f240bc74cd7` | 3403 | 79 / 78 | [CycloneDX](evidence/internal-960b66b33-macos-x64.cdx.json) |

**Tái lập trên một release candidate.** Lấy metadata theo đúng workflow, SHA và kiến trúc. So hash của archive với GitHub Actions digest, rồi so installer với SHA256SUMS. Dùng volume chỉ đọc trên macOS hoặc giải nén NSIS và app-64.7z trên Windows. Kiểm cả plugin/uninstaller của NSIS khi duyệt installer. Chạy `syft scan dir:<payload> --source-name <product-platform> --source-version <version> -o cyclonedx-json=<file>`. Tách app.asar bằng phiên bản @electron/asar trong lockfile. Lấy lịch sử object qua `git rev-list --objects <refs> -- enterprise` và `git cat-file --batch-check`, so ID blob với `git ls-tree -r <ref>` và `git hash-object` của các tệp/ASAR member có cùng kích thước. Lưu công cụ, version, số tệp, ngoại lệ, SBOM và checksum cùng RC. Chủ release phải đối chiếu cả package JS đã bundle và native tool mà trình quét bỏ sót.

## Đích mạng, dữ liệu và kết quả đo

| Luồng | Hành vi tại mốc kiểm kê | Bằng chứng và yêu cầu để đóng |
|---|---|---|
| Analytics | Thiếu cấu hình riêng thì dừng. Có token + host HTTPS thì một profile mới, giá trị sai hoặc lỗi đọc localStorage có thể bật PostHog. | Bốn trường hợp tái hiện fail trước sửa. Kiểm bổ sung SDK thật với recording transport. [PR 13](https://github.com/tigerthong1102/MoonBot/pull/13) |
| Báo lỗi qua @devs và hàng đợi | Điểm gửi mặc định ở upstream. Retry khi restart và truy vấn status có thể dùng thông tin của report. Payload gồm mô tả, chẩn đoán, install ID và email liên hệ khi có. | `server/index.ts` khởi tạo từ `devs-report-send.ts`. PR bỏ fallback, cô lập queue theo receiver, giới hạn ký status và hiển thị trạng thái disabled. [PR 14](https://github.com/tigerthong1102/MoonBot/pull/14) |
| Host doctor | Lệnh chẩn đoán Linux so giờ qua HEAD tới cloud upstream. | PR 14 dùng daemon thời gian của máy và trạng thái NTP. |
| Biểu tượng dịch vụ | ARM64 NetLog trên DMG thật ghi nhận 3 request favicon đến www.google.com và 3 request chuyển tiếp đến t0/t1/t3.gstatic.com trong luồng onboarding + Agent giả. Tham số gồm tên miền dịch vụ và kích thước. | 9051 sự kiện Chromium, URL_REQUEST_START_JOB còn ghi 70 request đến 127.0.0.1. Chưa bao phủ tiến trình Node, CUA và browser riêng. [Tổng hợp không chứa giá trị query](evidence/internal-960b66b33-arm64-network.json) · [PR 16](https://github.com/tigerthong1102/MoonBot/pull/16) |
| Login, subscription và checkout | Client giao thức vẫn biết cloud cũ và Dodo. Đường `ensureCloudAccount` truyền fetch luôn từ chối. Tài liệu và test identity xác nhận gate. | Cần thử deep link, checkout đã lưu, quyền truy cập remote, xác thực tổ chức và các nhánh gọi shell.openExternal trên đúng RC. |
| Relay, browser, provider | Pairing LAN, browser do người dùng điều hướng, BYOK và local model có đích khác nhau. | Phải ghi đích và mục đích theo provider, cấp quyền trước khi gửi nội dung. Chưa đo traffic OS/child cho các biến thể này. |
| Updater | Trong DMG cũ, app-update.yml khai báo GitHub tigerthong1102/StartupBot. Bản internal ghi disabled. | Xác minh trong trạng thái restart/upgrade, nguồn, chữ ký, khóa và rollback trước khi bật update. |

| Kịch bản desktop | Phạm vi đo lần này |
|---|---|
| Cài lần đầu; gỡ cài đặt | CI có cài nội bộ. Traffic của installer/uninstaller ở mức hệ điều hành chưa đo. |
| Mở app; onboarding; chạy Agent | Trace ARM64 với profile, home server, dữ liệu và fake engine cô lập. Smoke PASS. Không dùng credential dịch vụ thật. |
| Cấu hình/đăng nhập provider | Luồng onboarding chạy. Luồng OAuth hoặc API key thật và callback ngoài app chưa đo. |
| Browser tool; Computer Use | CI có bước browser riêng. Capture mười tình huống chưa bao phủ browser con hay thao tác CUA trên desktop được cho phép. |
| Gặp lỗi; kiểm tra update; chạy lại | Có fixture báo lỗi/delivery/status/queue sau restart và test preference. Chưa có packet capture toàn tiến trình trên installer RC cho ba trường hợp. |

Trên máy hiện tại, smoke Intel chạy trực tiếp từ volume đã timeout khi chờ renderer. Cùng harness với arm64 đã PASS. Bản Intel có smoke PASS trên runner Intel của workflow cũ. Ba kết quả này có điều kiện thực nghiệm khác nhau.

## Risk register

| Mức | Rủi ro, hiện vật | Điều kiện xử lý / chủ quyết định |
|---|---|---|
| P0 | Mã đóng tải hoặc nhúng lại dưới dạng chuyển đổi. Direct dependencies, binary do nhà cung cấp dựng và nguồn tải ngoài Git có license riêng. | Chủ release lần theo `package:prepare`, electron-builder, hooks, tarball/native SDK, bundled cloudflared/Chrome/CUA/DuckDB/ADB. So SBOM với bytes, xác minh checksum, notices, quyền sửa và quyền phân phối. |
| P0 | `prepare-android-tools.mjs` dùng URL platform-tools-latest rồi giải nén. Trong DMG Intel, ADB khai revision 37.0.1. Override bằng thư mục local cũng cần provenance. | [PR 19](https://github.com/tigerthong1102/MoonBot/pull/19) khóa 37.0.1 và SHA-256 trước giải nén, kiểm toàn bộ cây tệp cả với override offline. Đã đối chiếu 3 ZIP với size/SHA-1 trong chỉ mục Google, thử hỏng từng archive và thêm tệp. Quyền phân phối còn chờ xác nhận. [Điều khoản SDK Android](https://developer.android.com/studio/terms) |
| P0 | Font WOFF2 Geist, Geist Mono và Inter đã nằm trong UI nhưng thư mục licenses của DMG Intel thiếu ba bản điều khoản/copyright từ đúng package font. | PR copy văn bản gốc từ lockfile dependency, so byte trong smoke Windows/macOS. Test mới fail trên DMG trước sửa. [PR 15](https://github.com/tigerthong1102/MoonBot/pull/15) |
| P0 | `pnpm audit --prod` trên frozen workspace lock: 807 dependency, 2 low, 11 moderate, 7 high, 0 critical. Có mục vite/next thuộc tooling hoặc workspace khác. | Đối chiếu từng advisory với code/artifact thực tế, cập nhật phiên bản có bản vá và test lại. [PR 21](https://github.com/tigerthong1102/MoonBot/pull/21) nâng trực tiếp undici từ 8.11.2 lên 8.12.2, giữ engine Node và vượt 136 test cùng hai build. Quét lại cùng workspace còn 2 low, 7 moderate, 3 high (Vite, source-map-js và picomatch). Cần triage picomatch vì registry không nêu phiên bản vá dùng được. |
| P0 | Gitleaks 8.30.1, rules mặc định, quét snapshot main đã export, 7351 match. 7239 trong source-hashes.json của locale; nhiều mục khác trong test và vector. | Số match không phải số bí mật thật. Quét bổ sung lịch sử ref fork và các payload được mô tả bên dưới. Cần duyệt các phát hiện còn lại với chủ sở hữu và xác nhận trên đúng RC. Không công bố payload của scanner. |
| P0 | Tài liệu/chứng từ có chỉ dẫn độc hại, dữ liệu nhiều công ty, lộ qua tool/cloud hoặc MCP. | Tách dữ liệu khỏi chỉ dẫn, cấm egress ở executor với grant đọc local, gắn tool permission và credential vào một công ty. Thử fixture PDF độc hại với sink cục bộ đã kiểm soát. Chưa có bằng chứng toàn đường đi cho workflow kế toán. |
| P0 | Chữ ký production, danh tính publisher, ảnh/chứng từ pháp lý, điều khoản hỗ trợ và xử lý dữ liệu cá nhân. | Windows internal unsigned, macOS ad-hoc. Founder + cố vấn xác nhận quyền hình ảnh, quyền dùng tài liệu vendor, hợp đồng, privacy, người nhận và retention. |
| Cao | Sai mapping, SQL injection, thao tác trùng, mất điện khi ghi, luật hoặc skill lỗi thời. | Giữ operation read-only với truy vấn tham số hóa cố định. Chỉ bật ghi sau preview, xác nhận, idempotency và kiểm lại trên phiên bản đã duyệt. Ràng buộc hiệu lực luật và nguồn gốc manual. [Threat model và lab](../startupbot/business-connectors/README.md) |
| Cao | Thiếu bản ghi mới nhất ngay sau thu hồi quyền. | CI đã quan sát assertion thiếu dòng off. Sửa endpoint đọc đợi queue ghi xong bằng phần OSS tương ứng từ upstream. [PR 17](https://github.com/tigerthong1102/MoonBot/pull/17) |

## Quyết định theo sản phẩm

| Phạm vi | Quyết định | Bằng chứng để đổi quyết định |
|---|---|---|
| Desktop thương mại | **NO-GO** | Rights và notices cả artifact, logo, kiểm soát endpoint, kiểm thử cả OS/child process, signing và vận hành hỗ trợ. |
| Kế toán | **GO cho demo nội bộ bằng file giả, NO-GO cho công bố connector hãng** | Đúng build MISA, dataset demo được phép, báo cáo hãng làm oracle, sai lệch theo từng chứng từ, cách ly công ty, bản cài sạch. |
| BHXH | **NO-GO cho phát hành** | Sandbox và mẫu có hiệu lực, phân quyền dữ liệu nhân sự, luồng nháp → duyệt → xác minh. Tách ký/nộp cho người có thẩm quyền. |

Giữ PR độc lập để có thể revert từng thay đổi. Không dùng revert về fallback gửi chẩn đoán hoặc bỏ notices làm bản phát hành. Không tăng chi phí server vận hành cho những thay đổi này. Chi phí còn lại tập trung ở duyệt quyền, ký, môi trường Windows/vendor và hỗ trợ từng phiên bản.


## Quét bổ sung lịch sử và payload

Gitleaks 8.30.1 quét các commit reachable từ ref `origin/*` cục bộ tại thời điểm kiểm tra bằng `git --log-opts=--remotes=origin`. Công cụ báo 8.081 commit và 11.069 match. 10.937 match nằm trong bảng hash nguồn bản dịch, 123 trong đường dẫn test/vector theo quy tắc phân loại tên tệp. Chín vị trí còn lại gồm nhận dạng PEM trong mã, ví dụ CI và cấu hình analytics cũ. Đây là phân loại để duyệt tiếp. Không thử sử dụng chuỗi phát hiện làm credential.

Trên bộ cài `960b66b33`, quét thư mục payload giải nén của từng hệ điều hành ghi 15 match mỗi nền tảng. Quét riêng nội dung ASAR cho thêm một match mỗi nền tảng trong fixture `device-chrome.node-test.mjs`. Hai lượt có thể báo cùng một chuỗi. Miniﬁed bundle và định dạng nhị phân hạn chế mức bảo đảm. Kết quả chi tiết đã redact và được giữ cục bộ. [PR 22](https://github.com/tigerthong1102/MoonBot/pull/22) loại các tệp node-test khỏi bộ cài. Dùng FileMatcher thực của electron-builder trên ASAR đã giải nén cho kết quả 188/188 tệp fixture được chọn trước sửa, 0/188 sau sửa. Điểm vào electron/main.mjs vẫn được chọn.

## Phạm vi triển khai và rollback

Các PR [13](https://github.com/tigerthong1102/MoonBot/pull/13), [14](https://github.com/tigerthong1102/MoonBot/pull/14), [15](https://github.com/tigerthong1102/MoonBot/pull/15), [16](https://github.com/tigerthong1102/MoonBot/pull/16), [17](https://github.com/tigerthong1102/MoonBot/pull/17), [19](https://github.com/tigerthong1102/MoonBot/pull/19), [20](https://github.com/tigerthong1102/MoonBot/pull/20), [21](https://github.com/tigerthong1102/MoonBot/pull/21) và [22](https://github.com/tigerthong1102/MoonBot/pull/22) đều có thể duyệt độc lập. Nhánh kiểm chứng tập hợp bằng cherry-pick để dựng nội bộ. Nếu cần rollback sau tích hợp, dừng phân phối artifact đó, dựng lại từ SHA đã duyệt và chạy lại phép thử gắn với thay đổi. Các bản sửa dùng runner hiện có và code cục bộ. Không bổ sung server, thuê bao hoặc chi phí token khi đối chiếu file.

## Hồ sơ privacy và điều khoản cho bản bán

Founder cần mô tả các luồng dữ liệu đã đo của đúng bản phát hành. Ghi ai quyết định xử lý, dữ liệu nào chỉ nằm trên máy, nội dung nào đến provider do khách chọn, đơn vị nào nhận chẩn đoán, thời hạn giữ, cách rút quyền và đầu mối xử lý sự cố. Với chứng từ và hồ sơ nhân sự, phải xác định vai trò của khách hàng, StartupBot và nhà cung cấp model cho từng luồng, rồi để người phụ trách pháp lý đánh giá căn cứ xử lý và nghĩa vụ khi chuyển dữ liệu. Luật Bảo vệ dữ liệu cá nhân và nghị định quy định chi tiết cùng có hiệu lực từ 01/01/2026. [Luật 91/2025/QH15](https://vanban.chinhphu.vn/?docid=214590&pageid=27160) · [Nghị định 356/2025/NĐ-CP](https://vanban.chinhphu.vn/?classid=1&docid=216387&pageid=27160)

Điều khoản bán cần chỉ rõ từng nghiệp vụ, phiên bản và OS được hỗ trợ, chi phí model hoặc BYOK, cách sửa sai, thời hạn hỗ trợ và cách lấy lại dữ liệu. Hợp đồng không nên cam kết thay khách hàng ký số hoặc nộp hồ sơ. Hồ sơ nguồn mở cần đi cùng gói nhận được; thỏa thuận dịch vụ triển khai, đào tạo và hỗ trợ có thể mô tả riêng.

## Kiểm chứng bộ cài tích hợp

Bộ cài nội bộ tại `76fd9bbbd` đã qua job Windows x64 và macOS Intel. DMG arm64 được mở trên Apple Silicon cục bộ và chạy cùng smoke onboarding/Agent. Đã khớp SHA-256 của từng ZIP với GitHub, đọc commit từ metadata bên trong và so SHA-256 installer. Bộ cài có bản sửa analytics, báo lỗi, biểu tượng, thông báo license font, kiểm toàn vẹn ADB và registry đối chiếu tệp. Bản nâng undici và loại fixture thuộc commit tích hợp sau. [Run 44338592532](https://github.com/tigerthong1102/MoonBot/actions/runs/44338592532) · [Biên bản theo nền tảng](evidence/internal-76fd9bbbd-verification.json)

- **windows-x64**. Đã so 3488 tệp, có đủ ba notice font, 0 bản sao trùng byte với 26 blob Enterprise lịch sử. Traffic hệ điều hành Windows chưa đo.
- **macos-arm64**. Đã so 3408 tệp, có đủ ba notice font, 0 bản sao trùng byte với 26 blob Enterprise lịch sử. NetLog ghi 70 HTTP request tới 127.0.0.1 và 0 lượt favicon Google.
- **macos-x64**. Đã so 3408 tệp, có đủ ba notice font, 0 bản sao trùng byte với 26 blob Enterprise lịch sử. NetLog ghi 63 HTTP request tới 127.0.0.1 và 0 lượt favicon Google.
