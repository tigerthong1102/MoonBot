# Quyết định đầu tư connector Kế toán, BHXH và Sapo

**Ngày 18/11/2026. GO cho bộ kiểm kê Windows chỉ đọc và pilot đọc file xuất. NO-GO cho truy cập SQL sản xuất, legacy bridge, cài SQL tự động và phát hành thương mại.** Hai bằng chứng mạnh nhất cho nhu cầu khảo sát SQL 2005 là tài liệu Smart Pro 5.0 và FAST Accounting 11. Chưa đo được bao nhiêu khách hàng còn dùng hai tổ hợp này hoặc sẵn sàng trả tiền. Sapo mở đường đối chiếu đơn hàng/tồn kho qua file xuất, có thể thí điểm độc lập với SQL Server.

- [Hồ sơ sản phẩm, phiên bản, quyền và đường tích hợp](vendors.md)
- [Ma trận SQL Server 2000–2025 và sổ kiểm thử legacy](sql-compatibility.md)

## Audit repository

Cơ sở thiết kế là `origin/main@712adf52c215f3137fbb5a9bd108542e029d898d`. PR #1 (foundation) và #2 (OSS backport) đã merge. Các nhánh build desktop và mobile đang làm riêng. Không phụ thuộc artifact hoặc thay đổi chưa merge của chúng. [PR #1](https://github.com/tigerthong1102/MoonBot/pull/1) · [PR #2](https://github.com/tigerthong1102/MoonBot/pull/2)

| Điểm tái sử dụng trên main | Giới hạn cần xử lý |
|---|---|
| [Electron khởi chạy server, Windows x64 cùng runtime Node](../../../electron-builder.yml), [CUA Windows dùng named pipe riêng](../../computer-use-integration.md) | Khách hàng dùng runtime đóng gói. Fixture CLI chạy từ source dành cho kỹ sư. CUA của desktop cần quyền điều khiển riêng, tránh cho một phép đọc SQL quyền điều khiển màn hình. |
| [Gate MCP](../../../server/mcp-gate.ts) và [scope tool theo bot](../../verification/tool-selection.md) | Tận dụng lọc ở cả lúc liệt kê và thực thi. Cần thêm grant ở desktop ràng buộc enrollment máy, bot, người phê duyệt, công ty, mục đích và hạn dùng. Tool selection đơn thuần chưa ràng buộc tenant SQL. |
| [Private grant tới đúng child](../../../electron/local-computer-grant.mjs) | Dùng mô hình IPC do app sở hữu cho grant connector độc lập. Từ chối server cloud/lent, gọi từ xa và grant sau thu hồi. |
| [Vault reference một lần](../../../server/secret-vault.ts), [xử lý kho credential bị khóa](../../../electron/secure-credentials.mjs) | Ưu tiên Integrated Authentication trên máy đúng phạm vi. Với SQL auth dùng handle bí mật theo company, chỉ helper đổi handle trong bộ nhớ. Kiểm kho Windows/DPAPI trên gói thật trước khi lưu. |
| [Cài skill](../../../server/skills.ts), [định dạng package](../../../shared/package-format.ts), [cấu hình đóng gói](../../../electron-builder.yml) | Skill là hướng dẫn. MVP phân phối mã tin cậy cùng phiên bản app. Manifest mô tả version, capability, digest, minAppVersion. Pin signer + digest, chống rollback, cập nhật nguyên tử, thu hồi phiên cũ. Checksum tải cùng payload chưa xác thực tác giả. |
| [Công cụ dữ liệu DuckDB cục bộ](../../../server/data/tools.ts) đã có reader CSV/XLSX, tùy chọn CSV all_varchar, chọn sheet và bộ đọc theo loại | Với file Sapo, tái sử dụng reader sau khi giới hạn nguồn vào đúng file người dùng chọn, cố định sheet và schema, bảo toàn ID và decimal. Tool tổng quát còn nhận URL/glob, trả mẫu và có thể thay bảng; cần kiểm soát nguồn, đầu ra và vùng lưu riêng trước khi dùng cho doanh nghiệp. |
| [Quy trình fixture](../../verification/README.md), [ranh giới license](../LICENSE_AUDIT.md) | Dùng home/DB tạm và dữ liệu tổng hợp cho kiểm chứng. Quyền tái phân phối driver, lịch sử enterprise trong fork và chữ ký installer còn là gate thương mại. |

Không thêm SQL library vào luồng chung này. Chi phí đầu tiên là duy trì một collector cục bộ và một bộ so khớp phiên bản. Chỉ chọn ODBC/native hoặc TDS thuần JS sau khi đo ABI, quyền Windows, TLS và việc hủy truy vấn trên tổ hợp pilot.

## Đường đi từ yêu cầu đến dữ liệu

1. Người dùng chọn **Kết nối phần mềm kế toán** rồi duyệt phạm vi hiển thị trên máy. Ghi nhận “được phép tìm ứng dụng”, “được phép thử máy chủ X” và “được phép đọc công ty Y” là ba quyết định riêng. Hết quyền dừng mọi phép đọc mới, hủy pool/cursor và xóa handle.
2. **Discovery** trả evidence theo nguồn và phạm vi. Đầu vào local gồm uninstall keys, SCM, instance registry hai view, InstalledInstances cũ, registry ODBC, SQL Browser, LocalDB runtime. Tên/phiên bản app là gợi ý. Service dừng, lỗi ACL, không thấy engine và phát hiện driver là những trạng thái khác nhau. Chỉ bổ sung process/Program Files/shortcut nếu tài liệu hãng định danh đường dẫn cụ thể và có lợi so với registry. Không chạy shortcut, đọc command line, đọc file cấu hình chứa credential hay quét ổ đĩa. Cấu hình có thể đọc sau bằng parser khóa trường cho từng bản, trong grant riêng.
3. **LAN** bắt đầu từ server/instance trên giao diện vendor hoặc endpoint do người dùng xác nhận. MVP không quét subnet. Đề xuất pilot tối đa 3 đích chỉ định, 2 giây/đích, một đích đang thử, một vòng, hủy được. Broker kiểm lại IP sau phân giải và ở lúc mở socket theo allowlist đã duyệt, bao gồm IPv6. DNS/VPN đổi thì duyệt lại. Không broadcast. Named instance dùng port do DBA xác nhận, hoặc yêu cầu Browser đúng một máy khi được phép. Browser sử dụng UDP 1434, có thể bị tắt. Port động thay đổi, 1433 chưa chắc là port của instance. Lỗi phân giải/firewall/timeout không chứng minh máy không có SQL. [SQL Server Browser](https://learn.microsoft.com/en-us/sql/tools/configuration-manager/sql-server-browser-service-database-engine-and-ssas)
4. **Compatibility** so build engine với driver cụ thể, OS, bitness, mode auth, transport, cert, chính sách triển khai và tài liệu vendor. Xung đột registry hoặc phiên bản chưa biết yêu cầu thêm bằng chứng. Với 2000/2005 mặc định đề xuất xuất theo vendor. Adapter local-only và bridge chỉ là đề xuất nghiên cứu độc lập. Với bản mới chỉ cho phép probe metadata trên đích đã duyệt khi đủ điều kiện, chưa tác động dữ liệu nghiệp vụ.
5. **Connection + Permission Broker** tạo session có hạn cho đúng server/database/principal. Pool key có grant, company, database, phiên bản adapter và identity; thu hồi thì đóng pool. Không dùng chung pool của công ty A cho B. Chặn sysadmin/db_owner, quyền ghi/EXECUTE, quyền chéo và quyền không xác định. Thử metadata tối thiểu trước. Kênh TCP phải xác thực endpoint và mã hóa, bao gồm khi dùng SSPI. Không chuyển sang SQL auth khi Windows auth bị từ chối. Một lần thử auth, không thử credential khác. Cho phép một retry lỗi vận chuyển tạm thời trước khi trả dữ liệu, sau đó dừng. Timeout truy vấn và giới hạn tài nguyên theo profile, hủy khi server quá tải. Timeout giữa trang làm báo cáo chưa hoàn chỉnh, không cộng trùng dữ liệu.
6. **VendorAdapter** khai báo vendor/build/schema và capability theo version. Phương thức detect/plan thuần evidence, identify nhận session metadata, read nhận operation ID đã định cùng typed params. Phần lõi chỉ cung cấp danh sách operation và truy vấn đã biên dịch, không nhận SQL từ model. Hợp đồng business gồm snapshot công ty/niên độ và provenance. Luồng đầu tiên là danh mục, sau đó tồn kho/chứng từ và đối chiếu trùng. BHXH dùng riêng danh sách lao động tối thiểu, kiểm thiếu trường và hồ sơ nháp. Không hiển thị PII với bot không có grant. Nếu adapter gặp schema lạ thì chuyển thành diagnostic.
7. **Skill, MCP và UI** dùng mã kết quả có cấu trúc. Ví dụ “Tìm thấy SQL Server. Chưa xác định được dữ liệu của công ty.” Với 2005, “Máy đang dùng SQL Server 2005. Hãy chọn xuất dữ liệu từ phần mềm để đối chiếu.” Chỉ nói “Đã kết nối công ty …” khi kiểm chứng identity và phép đọc đã qua. Đưa lệnh cài/chạy local ra khỏi SKILL.md. Gỡ gói phải thu hồi grant, đóng tiến trình, xóa token/cache theo phạm vi và ngừng đăng ký tool cả sau restart.

**60 doanh nghiệp** là 60 grant và kết quả riêng. Không mặc định mở toàn bộ database của kế toán dịch vụ. Chia hàng đợi theo server, khởi đầu một tác vụ mỗi server, cắt số dòng theo trang, chỉ tích lũy tổng sau khi trang đã xác nhận. Giao diện phân biệt hoàn tất, thiếu quyền, chưa xác định niên độ và dữ liệu đọc dở theo công ty. Gộp báo cáo chỉ khi người dùng có quyền tương ứng.

## Setup Assistant và tiêu chí dừng

| Trạng thái | Hành vi đề xuất |
|---|---|
| A. Engine đang chạy | Xác nhận endpoint, engine, quyền và database rồi mới thử đọc. |
| B. Service dừng | Báo trạng thái, hỏi DBA/đầu mối vận hành. Không tự start. |
| C. Dữ liệu trên LAN | Dùng server đã duyệt. Máy trạm không cần cài engine. |
| D. Thiếu quyền | Chỉ ra quyền tối thiểu cần DBA cấp, không thử lại mật khẩu. |
| E. Driver không phù hợp | Ghi build/bitness và tài liệu cặp tương thích. Chọn export khi chưa chứng minh đường đọc. |
| F. Thực sự cần instance mới | Chỉ tạo dry run khi hãng xác nhận build, địa điểm lưu dữ liệu và chưa có endpoint phù hợp. |
| G. Cloud/DBMS khác | Sapo, AMIS và dịch vụ BHXH dùng API hoặc file đúng sản phẩm. |
| H. Thiếu database/attach/restore | Chuyển DBA/vendor xác nhận danh tính, backup và kế hoạch. Không tự attach/restore. |
| I. Legacy không đạt chính sách kênh truyền | Dừng trước auth, dùng export hoặc xem xét local-only đã được phê duyệt. |
| J. Vendor chỉ hỗ trợ engine hết vòng đời | Hỗ trợ xuất/đối chiếu. Migration là dự án riêng có backup, rollback, test và ký nghiệm thu. |

Dry run của F hiển thị căn cứ vendor, license engine/driver, OS/CPU/RAM/dung lượng, quyền Admin cần ở bước nào, instance/port/service có thể xung đột, URL chính thức, signer và digest kỳ vọng từ nguồn tin cậy, thay đổi dự kiến, cách dừng và nhật ký đã lọc. Sai chữ ký/digest, có instance trùng, từ chối cài hoặc chưa có phương án khôi phục thì dừng. Chỉ làm installer sau pilot cho đúng tổ hợp đã chứng minh. Không nâng/hạ cấp tại chỗ, sửa chính sách hệ thống hoặc tự cài bản hết hỗ trợ.

## Threat model và giới hạn pháp lý

| Tài sản / tình huống | Kiểm soát và phép thử bắt buộc |
|---|---|
| Credential, tên máy, MST, hồ sơ lao động, bản xuất | Grant cục bộ, handle bí mật, whitelist cột, log ID ngẫu nhiên + loại lỗi + số dòng + thời hạn lưu. Không ghi DSN, query params, stack driver thô, đường dẫn hay tên DB vào telemetry. Thử chuỗi đánh dấu trong mọi sink. |
| Database giả tên MISA, sheet chứa chỉ dẫn AI, đường dẫn shortcut/UNC | Đối chiếu fingerprint và identity nghiệp vụ với phần mềm gốc. Xem nội dung là dữ liệu. Parser file giới hạn row/size/zip ratio, chặn external links, macro và formula execution. |
| Sai tenant, năm tài chính, thao tác lúc thu hồi | Bind tại broker và query session. Test hai công ty trùng mã chứng từ, restart, đổi người dùng và revoke giữa lúc đọc. |
| Bridge legacy thành điểm truy cập mạng ngang | Chỉ nghiên cứu trong VM được cấp phép, dữ liệu giả, một DB, một principal, firewall mặc định từ chối, không Internet inbound, không route rộng, xác thực hai đầu cho kênh trung gian. Thẩm định chân cuối tới DB riêng. TLS trên bridge không sửa được chân bridge–2005. Chỉ chọn local shared memory khi chứng minh cùng máy, transport và ACL. |
| Legal action và license | Khóa xuất hóa đơn, ký số, nộp hồ sơ và ghi bảng. Xác định vai trò xử lý dữ liệu, mục đích, phạm vi đồng ý/ủy quyền, lưu giữ, xóa, chuyển dữ liệu ra ngoài và điều khoản vendor trước pilot với dữ liệu thật. Cần ý kiến chuyên môn pháp lý trước bán. |

Tài liệu pháp lý khởi điểm gồm Luật Bảo vệ dữ liệu cá nhân có hiệu lực 01/01/2026, Luật Kế toán và Luật BHXH. Rà lại văn bản sửa đổi, hướng dẫn thi hành và hợp đồng theo thời điểm triển khai. [Luật 91/2025/QH15](https://vanban.chinhphu.vn/?docid=214590&pageid=27160&typegroupid=3) · [Luật Kế toán](https://vanban.chinhphu.vn/?classid=1&docid=183198&pageid=27160&typegroupid=3) · [Luật BHXH](https://vanban.chinhphu.vn/?docid=211199&pageid=27160)

## Kinh tế sản phẩm

Nhóm cần phỏng vấn đầu tiên là kế toán dịch vụ quản lý nhiều pháp nhân, doanh nghiệp giữ máy chủ cho sổ nhiều năm, đơn vị dùng bản on-prem tùy biến và đơn vị đang chuyển phần mềm. Đây là giả thuyết tuyển pilot. Hỏi build đang chạy, quy trình xuất hiện tại, thời gian mỗi kỳ đối chiếu, tần suất phát sinh lỗi và giá khách hàng thực sự chấp nhận. Xin một bản xuất đã ẩn danh và một báo cáo đối chứng có cùng thời điểm. Ghi cả số khách từ chối và lý do.

Lợi thế kinh doanh có thể đến từ việc nhận diện đúng SQL 2005 và đưa khách đến kết quả kế toán đối chiếu được ngay cả khi kết nối trực tiếp bị chặn. Một legacy driver làm tăng ma trận OS × bitness × bản vá × edition × auth, chi phí lưu VM có license, tái kiểm tra khi EDR/Windows cập nhật, ký helper, xử lý sự cố và rủi ro hỗ trợ ngoài giờ.

Gọi F là chi phí kỹ thuật/QA/license/bảo mật cố định hàng năm của **riêng** adapter legacy. Gọi P là phần doanh thu tăng thêm mỗi khách mỗi năm so với gói export, V là chi phí hỗ trợ và triển khai tăng thêm mỗi khách. Điểm hòa vốn là làm tròn lên F/(P−V) nếu P>V. Nếu P≤V thì tăng số khách không giải quyết được chi phí. Chỉ điền F từ timesheet/quote, P từ pilot trả tiền hoặc cam kết có điều kiện, V từ ticket thực. Theo dõi tỷ lệ kết nối an toàn trên toàn bộ máy đủ điều kiện, thời gian tới báo cáo đối chiếu đầu tiên và phút hỗ trợ theo tổ hợp. Không đoán quy mô thị trường từ số lượt tải.

| Kịch bản | Tín hiệu quyết định | Phân bổ nguồn lực |
|---|---|---|
| Tốt | Nhiều pilot trả phí có cùng build, schema ổn định, đường read-only an toàn, P−V dương và đủ bù F | Duy trì một adapter cho đúng cohort đã chứng minh. Mở rộng capability từng phép đọc. |
| Cơ sở | Nhiều bản cài phân mảnh, nhưng xuất file và đối chiếu đáp ứng công việc định kỳ | MVP discovery + file; bán theo giá trị đối soát, ghi nhận nhu cầu SQL để ưu tiên. |
| Xấu | Không có quyền, license hoặc đường đọc an toàn, support vượt phần doanh thu | Chỉ hỗ trợ chuẩn file đã nghiệm thu. Từ chối nhận cam kết legacy SLA. |

SQL 2000 chỉ nên nhận diện và hướng dẫn export. Migration có thể là dịch vụ riêng theo dự án với DBA/vendor, có đối chiếu trước/sau và có thể quay lại. Lõi discovery, session scoped và catalog phép đọc có thể tái dùng ở ERP/kho vận. Chỉ tách SDK công khai sau khi ít nhất hai adapter độc lập chứng minh cùng một contract, có test compatibility và quy ước version/deprecation.

## Tự review trước khi chuyển giai đoạn

| Góc nhìn | Mức | Kết luận và quyết định |
|---|---|---|
| SQL legacy | BLOCKER cho direct 2005 qua TCP | Engine thiếu TLS 1.2. Driver lịch sử và TDS 7.2 chưa đủ. Chỉ GO khảo sát, export và lab cô lập được duyệt. |
| Windows/Electron | HIGH cho one-click | Cần chứng minh non-admin, registry thật, build Win10/11 x64, installer đã ký, restart/uninstall và grant bridge từ desktop. Collector không yêu cầu quyền admin trong thiết kế. |
| Bảo mật | BLOCKER cho production | Chưa chứng minh thu hồi, quyền SQL hiệu lực, fingerprint, cô lập công ty và redaction suốt đường đi. Không mount helper vào MCP. |
| Solo founder | HIGH cho đầu tư bridge, MEDIUM cho export | Có căn cứ vendor để tuyển pilot. Chưa có bằng chứng khách trả tiền, mẫu dữ liệu thật được phép hay chi phí support. Dùng ngưỡng hòa vốn. |
| Vận hành | LOW cho công cụ lab chạy thủ công | Dừng an toàn và mã lỗi có cấu trúc giảm chi phí tái hiện. Cần theo dõi cold start và tỷ lệ báo thiếu nguồn. |

## Kế hoạch PR và nghiệm thu

1. Audit, ma trận và quyết định đầu tư (PR tài liệu). Discovery cục bộ (PR độc lập từ main) dùng collector cố định, không nhận shell, host LAN hoặc SQL. Đối chiếu trên Windows dùng một lần.
2. Compatibility (PR kế tiếp Discovery) phân loại metadata/lỗi, kiểm fixture 2005/2008 và đọc scalar từ LocalDB tạm nếu runner có sẵn. Giữ riêng nhánh legacy lab và hiện đại.
3. Connection và permission broker. Chọn đúng một tổ hợp pilot từ bảng hãng; cần DB fixture có TLS xác thực, tài khoản Windows/SQL được cấp, quyền SELECT view, hai tenant và DBA dựng quyền âm. Đạt từ chối quyền quá rộng, mất mạng, quá tải, revoke và restart trước khi nối MCP.
4. Smart Pro, MISA SME, eBH Pro mỗi adapter một PR sau khi có bản demo được phép và báo cáo gốc. Sapo xuất file là luồng độc lập; lấy mẫu đơn hàng và sản phẩm cùng shop trước khi viết mapping. Cân nhắc API sau khi có scope, quota, điều khoản và tenant thử.
5. Setup Assistant dry run A–J. Installer ký chỉ xét sau khi chứng minh trường hợp F. Skill + UX sau consent và E2E Windows. Production sau phê duyệt pháp lý và pilot có số liệu.

| Bộ test bắt buộc | Cách tạo điều kiện và tiêu chí đạt |
|---|---|
| Không có engine, chỉ driver/SSMS/Compact/LocalDB, Browser tắt, nhiều instance, service dừng, registry cũ hoặc không đủ quyền | Fixture và Windows disposable. Không báo connected, không đánh đồng không nhìn thấy với không cài. Chạy thêm bằng tài khoản thường trên Win10/11 và máy trạm dùng server LAN. |
| Từng SQL 2000–2025 và riêng 2008 R2 | Fixture cho major/minor, record thật theo ma trận. Bổ sung service chạy/dừng của 2005 trên VM được phép. Không đánh đồng fixture với legacy verified. |
| LAN, DNS/IP thay đổi, VPN tắt, port động, Browser dừng, nhiều đích | Topology lab có scope rõ; không mở rộng scope hay port; hết giờ phải dừng. |
| Mật khẩu SQL sai, Windows auth thiếu quyền, driver sai bitness/incompatible, lỗi TLS/cert | Tài khoản tổng hợp, cert lỗi, engine patch khác nhau. Kiểm một lần auth, không hạ bảo mật, đầu ra không chứa credential. |
| Tiếng Việt, TCVN3, decimal, ngày, mã 0 đầu, chứng từ trùng, nhiều công ty/năm, tên DB giả | Hai doanh nghiệp có mã trùng nhau, golden file theo báo cáo vendor, kiểm cả tổng, từng dòng và sai tenant bị chặn. |
| Rớt mạng giữa trang, quá tải, hủy/thu hồi giữa chừng | Tiêm lỗi, kiểm timeout/cancellation, không cộng trùng, không đưa báo cáo dở thành hoàn tất. |
| Không Admin, người dùng từ chối scope hoặc installer, bộ cài bị sửa, legacy quá rủi ro | Kết quả có lý do, không mutation. Kiểm signer/digest sai, không mở SQL ra Internet. |
| Restart, update/uninstall, 60 công ty | Vô hiệu hóa handle cũ, xóa cache theo policy, grant riêng từng công ty, giới hạn tải, không rò dữ liệu chéo. |

**Báo cáo giai đoạn 0.** Ba file tài liệu trong thư mục này ghi audit, vendor, SQL, threat model, test và kinh tế. Đã đối chiếu nguồn sơ cấp và trạng thái GitHub. Chưa kiểm thử phiên bản SQL nào trong phạm vi audit. Chưa mua license/phần cứng hay xác minh hóa đơn dịch vụ. Không quy đổi thời gian kỹ sư/CI thành doanh thu. Vendor verified, legacy environment verified và production qualified đều chưa đạt cho StartupBot. GO làm lab và discovery, chưa có cơ sở đánh giá an toàn dùng tại khách hàng.

## Bàn giao giai đoạn 1 và 2

| Hạng mục | Giai đoạn 1, discovery cục bộ | Giai đoạn 2, compatibility lab |
|---|---|---|
| Đã triển khai | CLI có opt-in và timeout, collector registry/SCM, bộ hợp nhất bằng chứng. [PR #5](https://github.com/tigerthong1102/MoonBot/pull/5) | Phân loại metadata/lỗi, fixture registry legacy và phép đọc LocalDB độc lập. [PR #6, dựa trên #5](https://github.com/tigerthong1102/MoonBot/pull/6) |
| File | scripts/business-connectors/{inspect-local.ts,windows-inventory.ps1,discovery.ts,discovery.fixture.ts,README.md}; workflow business-discovery.yml | compatibility.ts, compatibility.fixture.ts, instance-registry.ps1, lab/{legacy-registry.ps1,localdb.ps1,verify-sample.ts}; sửa collector, README và workflow |
| Kiểm chứng | macOS 19/19. Runner Windows Server 2022 nhận đúng một app giả dưới HKCU và khớp SCM khi có 0 dịch vụ engine. [Windows run #5](https://github.com/tigerthong1102/MoonBot/actions/runs/44220861308) | macOS 21/21 cho hai bộ và TypeScript strict. Windows 20 đạt, bỏ qua đúng 1 ca dành riêng cho máy ngoài Windows. Bước Windows đọc khóa registry tổng hợp kiểu 2000/2005, xác minh LocalDB thật và dọn fixture đều đạt. [Windows run #6](https://github.com/tigerthong1102/MoonBot/actions/runs/44221365221) |
| SQL thật và chưa thử | Dò dấu vết không mở kết nối. Các generation 2000–2025 có fixture. Chưa thấy dịch vụ SQL đang chạy/dừng trên máy khách thật. | Đã đọc **SQL Server 2019 Express LocalDB 15.0.4382.1**, Windows Server 2022 x64 image 20261112.366.7, System.Data assembly 4.0.0.0 x64, named pipe, NTLM. Node nhận đúng “Đắk Lắk”, mã “0000123456” và decimal “-12345678901234567890.1200”. Chưa thử engine 2000/2005/2008/R2/2012/2014/2016/2017/2022/2025 hoặc 2019 qua TCP thường. |
| Sai sót tìm được | Collector hết thời hạn trên runner lạnh. Bản cuối dùng SCM và serializer .NET trực tiếp, đóng stdin và giữ timeout cứng 30 giây. Hai workflow ở trên đã đi qua collector. | PowerShell chuyển JSON sang Node có BOM. Đã sửa decode UTF-8 nghiêm ngặt, giữ nguyên so sánh giá trị và scale trong test. |
| Giả định và bảo mật | Dấu vết uninstall chưa xác thực vendor. Chưa xác minh coverage trên Windows 10/11, x86, phiên không có quyền admin hoặc máy dùng LAN. Không cấp tool cho agent. | Tài khoản sở hữu fixture, câu SELECT cố định. Chưa chứng minh read-only login, mã hóa TCP, schema, cô lập đa công ty hoặc quyền thu hồi trên SQL thật. |
| Hạn chế SQL 2005 | Registry/fixture chỉ cho hint engine, chưa xác thực phiên bản server. | Chưa có OS/engine/driver legacy được cấp phép. TLS 1.2 trên TCP đến engine 2005 là blocker đã biết. |
| Chi phí và rủi ro thương mại | Job Windows cuối chạy 38 giây wall clock. Không mua máy, driver hay dịch vụ vendor. | Job Windows cuối chạy 53 giây, đã có các lần chạy lại khi sửa lỗi. Chưa có số tiền CI thực trả hoặc chi phí support/tenant. |
| Quyết định | GO dùng công cụ phòng lab. Chưa GO đưa vào menu khách hàng. | GO cho pilot có tenant và bộ dữ liệu đối chứng. NO-GO cho direct legacy, installer và production. |

**Mức chứng minh.** Code complete trong phạm vi hai PR kỹ thuật. Fixture verified cho đúng các trường hợp trên. Vendor verified, legacy environment verified và production qualified đều chưa đạt. Việc vendor mô tả một sản phẩm trong tài liệu không nâng mức xác minh của adapter.

**Bốn kết luận tại điểm dừng.** SQL legacy — BLOCKER cho 2005 TCP. Windows/Electron — HIGH cho desktop one-click vì mới kiểm runner Server 2022. Security — BLOCKER cho dữ liệu khách hàng đến khi chứng minh quyền SQL và ranh giới tenant. Founder — MEDIUM cho pilot bằng file xuất, HIGH cho chi phí vận hành bridge. Điều kiện tiếp theo là một máy Windows thử đã duyệt, hai công ty giả hoặc bộ demo có license, principal giới hạn và báo cáo cùng kỳ của phần mềm gốc. Với Sapo cần file xuất và quyền của đúng cửa hàng; pilot này có thể bắt đầu độc lập.
