# StartupBot Desktop và tự động hóa nghiệp vụ Việt Nam

**Mốc kiểm kê 18/11/2026.** Bản thử nội bộ có luồng Agent và công cụ đối chiếu tệp chạy được. Bán Desktop, công nhận tích hợp kế toán của một hãng và phát hành BHXH là ba quyết định riêng. Cả ba chưa đủ điều kiện. Có thể tiếp tục thử bộ đối chiếu với dữ liệu tổng hợp. Founder đã tạm dừng cả Smart Pro và MISA trong đợt này. [Điều kiện phát hành](commercial-readiness.md)

## Mã nguồn được kiểm tra

Đã fetch cả hai remote. Fork công khai ở `263a8fa2055c06894ba726619e975d6fb04df1d7`. Upstream ở `35d044295697ef2b79b889461af6902c85a1b456`. Hai phía có lần lượt 223 và 684 commit riêng theo đồ thị. Con số này bao gồm lịch sử cherry-pick. Tra cứu toàn bộ PR trước khi mở đợt sửa cho thấy #1–#11 đã merge, #12 đóng và không merge. Nhánh thử ASP còn tồn tại. Mã trên đó không phải khả năng của main. [Fork tại mốc kiểm kê](https://github.com/tigerthong1102/MoonBot/tree/263a8fa2055c06894ba726619e975d6fb04df1d7) · [Upstream](https://github.com/milind-soni/OpenMausBot/tree/35d044295697ef2b79b889461af6902c85a1b456) · [CI của main](https://github.com/tigerthong1102/MoonBot/actions/runs/44326874646)

| PR | Phần đã có trên main |
|---|---|
| [1](https://github.com/tigerthong1102/MoonBot/pull/1), [2](https://github.com/tigerthong1102/MoonBot/pull/2) | Nền fork, giới hạn phát hành, lựa chọn các bản sửa OSS từ upstream. |
| [3](https://github.com/tigerthong1102/MoonBot/pull/3), [4](https://github.com/tigerthong1102/MoonBot/pull/4) | Bộ cài Desktop nội bộ, bộ nhận diện và build mobile nội bộ. Đợt này đánh giá phân phối Desktop. |
| [5](https://github.com/tigerthong1102/MoonBot/pull/5), [6](https://github.com/tigerthong1102/MoonBot/pull/6), [9](https://github.com/tigerthong1102/MoonBot/pull/9) | Kiểm kê Windows, phân loại driver/engine và thí nghiệm LocalDB với quyền giới hạn. |
| [7](https://github.com/tigerthong1102/MoonBot/pull/7), [8](https://github.com/tigerthong1102/MoonBot/pull/8) | Ma trận hãng và đối chiếu CSV/XLSX cục bộ qua Data hoặc HTML độc lập. |
| [10](https://github.com/tigerthong1102/MoonBot/pull/10), [11](https://github.com/tigerthong1102/MoonBot/pull/11) | Quy trình lab 2005 và kế hoạch MISA SME 2026 trên instance thường 2019. |
| [12](https://github.com/tigerthong1102/MoonBot/pull/12) | Đã đóng. ASP Kế toán có phạm vi sản phẩm và quyền riêng. |

## Kiểm kê theo khả năng người dùng

“VERIFIED GOOD” chỉ áp dụng cho tiêu chí ghi ngay trong cùng hàng. “PARTIAL” bao gồm trường hợp có bằng chứng ở một build hoặc một lớp nhưng còn thiếu phép thử đầu cuối.

| Năng lực | Phân loại tại mốc kiểm kê | Bằng chứng và giới hạn |
|---|---|---|
| Agent Desktop, onboarding, trả lời qua provider | PARTIAL | Workflow đóng gói mở app đã cài, qua onboarding, tạo Agent, nhận trả lời từ fake engine. Chưa thử billing, key khách hàng, throughput hoặc chất lượng model thật. [Run nội bộ](https://github.com/tigerthong1102/MoonBot/actions/runs/44286893426) |
| BYOK và local model | PARTIAL | Driver và kiểm tra tool selection có hồ sơ [verification](../verification/tool-selection.md). Chưa benchmark tiếng Việt trên máy kế toán mục tiêu. |
| Browser và Computer Use | PARTIAL | `server/browser/cdp/`, `electron/local-computer-grant.mjs`, native CUA. Smoke trả trạng thái quyền. Chưa có bằng chứng điều khiển ứng dụng kế toán được cấp phép. |
| Tool, MCP, skills, memory, lịch | EXISTING — NEEDS INTEGRATION | `server/mcp-gate.ts`, `skills.ts`, `memory-store.ts`, `routines.ts` trong server. Chạy lại 1.018 test trong 9 file cho MCP gate, skills, memory, recall, routines, safety floor và saved steps/replay. Chưa có grant công ty/niên độ bao trùm mọi đường đọc và gửi qua model. |
| Tệp, tri thức, tìm lại hướng dẫn, học từ thao tác | PARTIAL | `server/data/tools.ts`, `server/recall.ts`, `server/saved-steps/`. [Saved steps](../verification/saved-steps.md) có replay và giới hạn cụ thể. Bộ tài liệu vendor theo phiên bản, ngày hiệu lực và đánh giá chứng từ VN chưa được nghiệm thu. |
| Pairing local, relay, updater, đăng nhập cloud, checkout | PARTIAL | `electron/main.mjs` truyền `unavailableStartupBotCloud` cho client account. Có mã giao thức và URL cũ. Updater của bản nội bộ báo disabled. Cần trace từng đường deeplink, relaunch, cấp quyền và tùy chọn đã lưu. |
| Analytics & báo lỗi | EXISTING — NEEDS FIX | Với host/token cấu hình, main mặc định opt-in. `bugReportEndpoint({})` chọn upstream khi người dùng tag @devs. Xem [báo cáo P0](commercial-readiness.md) và hai PR sửa độc lập. |
| Kiểm kê Windows | EXISTING — NEEDS INTEGRATION | CLI, SCM, registry hai view, ODBC và lab. Chạy lại 35 fixture cho discovery, compatibility và setup. Bằng chứng Windows [run #44247351833](https://github.com/tigerthong1102/MoonBot/actions/runs/44247351833). Thiếu onboarding chọn công ty và kết nối được xác nhận trong app. |
| Tự cài driver, SQL read-only, schema mapping | PARTIAL | `plan-setup.ts` tạo quyết định dry-run, `lab/readonly.ps1` thử quyền trong LocalDB. Chưa có installer driver đã duyệt, fingerprint schema hãng và đối chiếu theo build thực. |
| Đối chiếu chứng từ cùng công ty/kỳ | EXISTING — VERIFIED GOOD cho mẫu CT01/2025 | 8 test parser/so sánh qua. Trong Chrome, “Dùng dữ liệu mẫu” → “Đối chiếu” → tải báo cáo HTML. Tổng nguồn 140.0500, đối chứng 140.0400. Chứng từ 00017 lệch 0.0100, 00018 thiếu bên đối chứng, 00019 thiếu bên nguồn. [Định dạng và giới hạn](../startupbot/business-connectors/file-reconciliation.md) |
| Phải thu/phải trả, kho, bán/mua, thu chi, thuế, tổng hợp | MISSING bằng chứng connector vận hành trên hãng | Đối chiếu số tiền/chứng từ là tác vụ chạy được. Chưa có biên bản đọc sổ chi tiết, bảng cân đối, tồn kho, VAT hoặc ghi chứng từ qua ứng dụng gốc. |
| MISA SME 2026 / AMIS / FAST | BLOCKED cho xác nhận vendor | Cần đúng build, doanh nghiệp demo và báo cáo độc lập. AMIS có API yêu cầu bật kết nối trong tenant. [Tài liệu SME](https://helpsme.misa.vn/2026/kb/cau-hoi-thuong-gap-lien-quan-den-may-chu-sql/) · [AMIS](https://helpact.misa.vn/kb/lap-chung-tu-hach-toan-tu-du-lieu-ket-noi-voi-cac-ung-dung-khac-qua-api/) |
| BHXH nhiều hãng | BLOCKED cho pilot thực | eBH, iBHXH, EFY, VNPT, Viettel, Bkav và AMIS BHXH đã có [ma trận nguồn](../startupbot/business-connectors/vendors.md). Thiếu mẫu phiên bản hiện dùng và môi trường nhận hồ sơ nháp. |
| Ghi DB sản xuất, ký và nộp hồ sơ thật | UNSUPPORTED trong pilot | Chưa có hợp đồng thao tác ghi, idempotency, phê duyệt và chứng minh phục hồi trên vendor. [Thiết kế an toàn](../startupbot/business-connectors/README.md) |
| Windows/macOS đã ký thương mại | BLOCKED | Build nội bộ có Windows x64, macOS Intel/Apple Silicon. Thiếu bằng chứng phát hành có chứng chỉ nhà phát hành và notarization của RC. |

## Quyết định kiến trúc

1. **Giữ Agent đa ngành và các subsystem OSS, đặt nghiệp vụ sau ranh giới connector.** Dùng schema khai báo operation, quyền, phiên bản, nguồn evidence và hạn chế cho mỗi adapter. Gắn consent vào công ty, kỳ, đích, mục đích và người gọi. Dùng gate MCP và kho bí mật hiện có. Quyết định này giữ chi phí vận hành local và cho phép thêm nhân sự, bán hàng hoặc hành chính. [Thiết kế và threat model](../startupbot/business-connectors/README.md)
2. **Ưu tiên đối chiếu theo bản xuất được phép.** Hai nguồn tệp có thể tái lập, phạm vi chọn rõ và số tiền chính xác đến bốn chữ số thập phân. Giữ SQL/driver ngoài Agent. Chỉ tạo sidecar Windows khi có tổ hợp vendor/driver thực sự cần ABI hoặc quyền OS riêng. Grant có hạn qua IPC local, thu hồi được. Sidecar chạy quyền người dùng. [Lab và ma trận](../startupbot/business-connectors/sql-compatibility.md)
3. **Tách ý định của Agent khỏi quyền thực thi.** Phê duyệt thuộc người dùng trên app, tài liệu và kết quả tool chỉ mang dữ liệu. Khi thiếu schema, báo cáo độc lập, quyền đọc, ngày hiệu lực hoặc định danh công ty, dừng tác vụ tương ứng. Bản ghi có tác động ngoài máy cần khóa chống trùng, xác minh sau ghi và cơ chế giải quyết kết quả chưa rõ sau sự cố.

## 36 câu hỏi dùng để quyết định đầu tư

| # | Câu hỏi | Kết luận và căn cứ tại mốc kiểm kê |
|---:|---|---|
| 1 | Khi nào bán OSS độc lập? | Khi mọi thành phần của đúng artifact có quyền phân phối, hoàn tất nghĩa vụ và P0 đạt. [P0](commercial-readiness.md) |
| 2 | Code có xác minh quyền của mọi bên? | Cần chứng từ cấp quyền ảnh, phạm vi binary/SDK, điều khoản vendor và xử lý lịch sử. Xem LICENSE_GAP.md. |
| 3 | Repo sạch nên lấy từ đâu? | Từ allowlist snapshot được duyệt, kèm LICENSE, NOTICE và bằng chứng xuất xứ theo tệp. Kiểm độc lập rồi mới quyết định lịch sử. |
| 4 | Tái dùng Agent phần nào? | Orchestration, fixture, MCP, skills, routines, memory, browser và UI đã có. Phạm vi đã chạy ở bảng trên. |
| 5 | Bao nhiêu phần trăm cần xây? | Chưa thể ước lượng từ LOC. Định lượng số operation có oracle, số build vendor đã xác nhận và giờ hỗ trợ sau mỗi pilot. |
| 6 | Connector nằm đâu? | Logic thuần trong workspace, phần Windows cần driver ở process quyền tối thiểu, dùng grant app. Thiết kế hiện có trong business-connectors/README.md. |
| 7 | SQL 2005 qua TCP trên Windows 11? | Chưa thử thật. SQL 2005 thiếu TLS 1.2, không đạt chính sách TCP mã hóa hiện đại. [Microsoft](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/connect/tls-1-2-support-microsoft-sql-server) |
| 8 | Có xây bridge legacy? | Hoãn. Chỉ cân nhắc ở lab cô lập có media hợp pháp, transport local kiểm được và nhu cầu khách có số liệu. |
| 9 | Phát hiện instance thế nào? | Collector đọc registry + services sau consent. Xác minh engine, login và identity qua bước riêng. CLI chưa thành wizard. |
| 10 | Chọn driver nào? | Theo engine build, OS, bitness, TLS và auth. Ghép ODBC 11 với 2005 là ứng viên lab lịch sử. Cho 2019, thử ODBC 18 trên máy phù hợp. [Ma trận phiên bản](../startupbot/business-connectors/sql-compatibility.md) |
| 11 | Tránh hỏng DB? | Dùng export hoặc principal SELECT giới hạn view, truy vấn định danh sẵn, có timeout và row cap. |
| 12 | Biết mapping sai ra sao? | Kiểm schema fingerprint, company ID, kỳ, dấu, decimal và báo cáo hãng. Sai một điều kiện thì ngừng operation. |
| 13 | Chứng minh đối chiếu? | Hai nguồn độc lập và oracle theo chứng từ. Kết quả Chrome CT01 nêu trên, có cả hai trường hợp thiếu một bên. |
| 14 | Smart Pro đã xác minh chưa? | Founder tạm dừng. Giữ nguyên hồ sơ trước đây và không mở pilot trong đợt này. |
| 15 | Giới hạn MISA SME? | Phải biết SKU/Rxx, SQL instance thực và công ty/kỳ. LocalDB fixture chưa đóng được ba điều kiện này. |
| 16 | AMIS dùng đường nào? | API được nhà cung cấp công bố, theo scope và tenant được duyệt. Có thể thử file xuất do người dùng chọn. |
| 17 | Ưu tiên BHXH nào? | eBH có tài liệu import Excel. Chọn pilot sau khi có mẫu hiện hành và sandbox của đơn vị. [Hướng dẫn eBH](https://ebh.vn/bao-hiem-xa-hoi-dien-tu/huong-dan-nop-ho-so-bhxh-su-dung-phan-mem-ebh) |
| 18 | Làm được gì trước ký số? | Kiểm trường, kỳ, tính nhất quán trong danh sách giả lập, tạo nháp cho người phụ trách duyệt. Chưa có E2E vendor. |
| 19 | Phải phê duyệt ở đâu? | Trước trao credential, cài driver, gửi dữ liệu ra ngoài, nhập chứng từ, ký hoặc nộp. Mỗi quyền có đối tượng và thời hạn. |
| 20 | Mất điện thì sao? | Công cụ file có thể đọc lại đầu vào và chạy lại. Với ghi qua API, ghi ý định có khóa và kiểm tra trạng thái vendor trước retry. |
| 21 | Giảm tiền token? | Đối chiếu dùng phép tính local, chi phí token của workflow mẫu bằng 0. Chỉ dùng AI để giải thích dữ liệu tối thiểu đã duyệt. |
| 22 | Chạy AI local trên máy phổ thông? | Cần đo RAM/VRAM, thời gian phản hồi, chất lượng tiếng Việt theo cấu hình. Chưa có ngưỡng SKU. |
| 23 | RAG đã đủ? | Memory/recall hiện hữu. Thiếu corpus vendor có quyền sử dụng, test đúng phiên bản và thời điểm. |
| 24 | Manual thành skill thế nào? | Lưu provenance, trang/đoạn, hash, build hãng và cấp phê duyệt. Chạy workflow trên fixture trước khi đăng ký operation. |
| 25 | Khi nào vô hiệu skill? | Khi đổi fingerprint, quy định hết hiệu lực, mẫu biểu đổi hoặc regression fixture sai. Cần registry kiểm ở lúc chạy. |
| 26 | Hỗ trợ nhiều bản thế nào? | Dùng canonical operation dùng chung, lưu mapping và phép thử theo build. Không nhân bản logic tính tiền. |
| 27 | Chia sẻ mô hình giữa ngành? | Chia sẻ ID công ty, kỳ, nguồn, grant và audit. Giới hạn trường nhân sự, lương và y tế theo miền BHXH. |
| 28 | Cách ly nhiều công ty? | Scope cứng trước truy vấn, pool và cache theo grant/database. File tool lọc đúng mã và kỳ. Chưa có chứng minh cho connector SQL sản xuất. |
| 29 | Kế toán không biết SQL dùng thế nào? | Hiện dùng Data → Đối chiếu. Wizard SQL phải trình bày các bước phát hiện, driver, login, company, schema rồi operation. |
| 30 | Hỗ trợ khách không remote vào DB? | Dùng mã lỗi, phiên bản, số dòng, checksum fixture đã ẩn danh. Hai PR chặn đường chẩn đoán mặc định. |
| 31 | Phân phối update an toàn? | Giữ updater tắt cho nội bộ. RC cần feed do founder kiểm soát, ký, kiểm downgrade và thử rollback từ bản đã cài. |
| 32 | Solo founder duy trì gì? | Một phép đối chiếu, bộ fixture, một build vendor đã khóa phiên bản và một quy trình hỗ trợ. Ghi giờ cài/test cho mỗi khách trước mở rộng. |
| 33 | Gì ngoài MVP? | Ghi SQL, ký thật, cài ngầm, quét LAN, cloud bắt buộc, bridge đại trà và tự tái tạo skill không phê duyệt. |
| 34 | Thu tiền từ đâu? | Giả thuyết ban đầu là triển khai và đào tạo đối chiếu lặp lại. Đo phút tiết kiệm, số sai lệch đúng và khả năng trả tiền trong pilot. Chưa có bằng chứng doanh thu. |
| 35 | Khi nào mở bán? | Khi đúng artifact qua phạm vi pháp lý, bảo mật, install/update/uninstall và ma trận đã công bố. |
| 36 | Bằng chứng bàn giao nào cần lưu? | Installer, checksum, SBOM từng nền tảng, notices, trace, CI đúng SHA, oracle vendor, restore/revocation, privacy/terms và chữ ký nghiệm thu. |

## Thứ tự tiếp tục

P0 và xác minh nguồn phân phối đi trước RC. Cho phép demo file với dữ liệu giả. Pilot MISA đang tạm dừng theo quyết định của founder. Khi mở lại, điều kiện nghiệm thu gồm phiên bản Rxx, môi trường demo được phép, hai report cùng kỳ và quyền tối thiểu. Chỉ khi đó mới cam kết nghiệp vụ cụ thể. Với BHXH, cần chọn nhà cung cấp và bản mẫu còn hiệu lực. Hợp đồng thử nghiệm nên tính chi phí cài đặt, đào tạo và hỗ trợ riêng để đo chi phí duy trì bằng số liệu khách hàng thật.


## Kết quả triển khai sau mốc kiểm kê

Trong [PR 20](https://github.com/tigerthong1102/MoonBot/pull/20), Data và HTML độc lập gọi chung registry nội bộ. Sau khi người dùng chọn hai file, mã công ty và kỳ, adapter tạo bản tổng hợp cho đúng phạm vi và cấp quyền thực thi một lần. Ba test mới kiểm dữ liệu bị đổi sau lúc cấp, quyền giả hoặc bị dùng lại, và trường hợp thiếu dữ liệu phía đối chứng. Cả 11 test trong thư mục đối chiếu đều đạt. Tài khoản SQL, danh tính từ xa và quyền MCP liên tiến trình vẫn cần thiết kế riêng khi mở lại pilot có môi trường được cấp phép.

Chrome chạy lại HTML sinh từ commit `232fdea24`. Với CT01 kỳ 2025, hai chứng từ mỗi bên cho tổng 140.0500 và 140.0400. Báo cáo liệt kê 00017 lệch tiền, 00018 thiếu bên đối chứng và 00019 thiếu bên nghiệp vụ. Mã CT02 trong dữ liệu giả không đi vào tổng. Đây là phép thử nghiệp vụ đã chạy được trên máy, chưa xác nhận mẫu xuất của bất kỳ hãng nào.


**Test import ngoại tuyến.** Sau khi tải trang HTML độc lập, đã chuyển Chrome sang offline, chọn CSV UTF-8 BOM và workbook XLSX được tạo bằng openpyxl, ánh xạ cột tự động, điền QA01/2025 và tải báo cáo. File có thêm QA02 và năm 2024. Có bốn dòng nghiệp vụ khớp phạm vi, ba dòng đối chứng. Tổng 14.2500 so với 14.2400. Báo cáo nêu 0001 vừa lặp vừa lệch 0.0100, 0003 thiếu bên đối chứng và 0004 thiếu bên nghiệp vụ. Trong đoạn từ chọn tệp tới tải báo cáo, trình duyệt ghi 0 request. Dùng dữ liệu tổng hợp; số liệu này chỉ xác nhận đường import trong công cụ cục bộ.

## Bàn giao theo giai đoạn

| Giai đoạn | Kết quả bàn giao | Điều kiện còn lại |
|---|---|---|
| 0 · Kiểm kê | Khoanh SHA, quyền nguồn/asset, các PR đã merge, năng lực hiện hữu, test đã chạy và 36 quyết định ở trên. | Mốc mới cần đối chiếu lại với commit và installer mới. |
| 1 · P0 thương mại | Có sửa opt-in, báo lỗi, icon mạng, license font/CUA, pin ADB, loại fixture và cập nhật HTTP client. [Bằng chứng và PR](commercial-readiness.md) | Còn quyền thương mại của asset/binary, phụ thuộc chưa phân loại, network ngoài Chromium, ký và hỗ trợ môi trường thật. |
| 2 · Nền connector | Registry chạy trong renderer cho nghiệp vụ đối chiếu file, grant một lần, xử lý và test cách ly theo công ty/kỳ. | Ranh giới file-picker hiện hữu chỉ áp dụng với người đã được phép mở file. SQL, MCP và sidecar cần quyền được kiểm ngay ở tiến trình thực thi. |
| 3 · SQL | Giữ collector và bộ thử LocalDB đã có. Đã chạy lại 35 fixture. [Ma trận SQL và môi trường thực](../startupbot/business-connectors/sql-compatibility.md) | Cài driver mới chỉ lập kế hoạch. SQL Server 2005, SQL Server 2019 instance thường của hãng và toàn luồng Windows 10/11 chưa đạt nghiệm thu. |
| 4–5 · Smart Pro, MISA | Tạm dừng theo quyết định của founder. | Chờ founder mở lại. |
| 6 · BHXH | Tài liệu ma trận xác định đường import và vai trò người duyệt. | Thiếu sandbox, mẫu hợp lệ và đối chứng của nhà cung cấp. Chưa có pilot đạt nghiệm thu. |
| 7 · Tri thức, skill | Đã chạy lại test của memory, recall, skills và saved steps trong 1.018 test nền tảng. | Chưa có corpus nghiệp vụ có quyền sử dụng và bộ câu hỏi chuẩn theo phiên bản/ngày hiệu lực để nghiệm thu RAG hay skill sinh từ manual. |
| 8 · Bộ cài | Đã dựng và thử Windows/macOS nội bộ. Xem số liệu theo SHA và kiến trúc. [Báo cáo artifact](commercial-readiness.md) | Quyết định bán và các phiên bản phần mềm khách hàng được hỗ trợ vẫn chờ các điều kiện P0. |
