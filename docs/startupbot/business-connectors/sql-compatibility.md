# Ma trận khả thi SQL Server

Mốc khảo sát 18/11/2026. Cột driver chỉ nêu một cặp đã có tài liệu để chọn thí nghiệm. Các cặp khác giữ trạng thái UNKNOWN. Chỉ một kết quả tích hợp tái lập trên đúng build mới nâng cấp trạng thái StartupBot. Express, Standard, Enterprise, default và named instance phải ghi riêng trong biên bản. Express là edition của Database Engine. Compact là engine nhúng trong ứng dụng, thường có file SDF. LocalDB là runtime theo người dùng, có thể tự khởi động khi kết nối. Bước discovery chỉ ghi nhận dấu vết. [Compact](https://learn.microsoft.com/en-us/aspnet/web-forms/overview/older-versions/getting-started/deployment-to-a-hosting-provider/deploying-sql-server-compact-databases-2-of-12) · [LocalDB](https://learn.microsoft.com/sql/database-engine/configure-windows/sql-server-express-localdb)

| Engine | ProductVersion | TDS được tài liệu hóa | Driver làm căn cứ lịch sử hoặc ứng viên | Quyết định trước khi có lab |
|---|---|---|---|---|
| 2000 | 8.00 | 7.1 / 7.1 rev 1 | SNAC 2008 từng công bố hỗ trợ | Kiểm kê, export. Không xây adapter sản xuất cho MVP. |
| 2005 | 9.00 | 7.2 | SNAC 2005, SNAC 2008, ODBC 11 | Direct TCP theo chính sách TLS ≥1.2 là UNSUPPORTED. |
| 2008 | 10.0 | 7.3.A | ODBC 17.3 theo ma trận lịch sử | Kiểm SP/CU/GDR và driver/OS trước thử TLS. |
| 2008 R2 | 10.50 | 7.3.B | ODBC 17.3 theo ma trận lịch sử | Nhánh vá khác 2008. Ưu tiên lab eBH Pro đời cũ. |
| 2012 | 11.0 | 7.4 | ODBC 17.10 theo ma trận lịch sử | Xác định bản vá TLS và vòng đời từng thành phần. |
| 2014 | 12.0 | 7.4 | ODBC 18.5 theo ma trận lịch sử | Đối chiếu KB và build thật của khách hàng. |
| 2016 | 13.0 | 7.4 | ODBC 18.5 theo ma trận lịch sử | Engine có TLS 1.2. Hỗ trợ mở rộng thông thường đã hết tháng 7/2026. [Vòng đời 2016](https://learn.microsoft.com/en-us/lifecycle/products/sql-server-2016) |
| 2017 | 14.0 | 7.4 | ODBC 18.7 theo ma trận hiện hành | Thử hiện đại, tùy ma trận hãng. |
| 2019 | 15.0 | 7.4 | ODBC 18.7 | Ưu tiên pilot MISA SME 2026 trên instance thường; xác minh tên DNS trên chứng chỉ khi dùng TCP. |
| 2022 | 16.0 | 7.4 / 8.0 | ODBC 18.7 | Thử ở nơi đã có engine hoặc có chứng nhận phù hợp; xác nhận mode TLS/TDS thực tế. |
| 2025 | 17.0 | 7.4 / 8.0 | ODBC 18.7 | Ưu tiên khi hãng liệt kê đúng phiên bản. |

Nguồn tương ứng là đặc tả giao thức, lịch sử build và ma trận driver, mỗi nguồn trả lời một câu hỏi riêng. Ô trống trong ma trận nghĩa là thiếu chứng nhận ở phiên bản đó. Các bản phát hành cũ có thể vẫn hoạt động về mặt kỹ thuật. [MS-TDS, phụ lục A](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-tds/135d0ebe-5c4c-4a94-99bf-1811eccb9f4a) · [Bảng build](https://learn.microsoft.com/en-us/troubleshoot/sql/releases/download-and-install-latest-updates) · [Ma trận ODBC hiện hành](https://learn.microsoft.com/en-us/sql/connect/odbc/windows/system-requirements-installation-and-driver-files) · [Bản lưu chính thức tháng 3/2025, còn các cột 2005–2016](https://github.com/MicrosoftDocs/sql-docs/blob/8ee7f72294c258d7290d17ce32137a6401ea4640/docs/connect/odbc/windows/system-requirements-installation-and-driver-files.md)

## SQL Server 2005 trên Windows hiện đại

Microsoft kết thúc hỗ trợ mở rộng tháng 4/2016. SQL Server 2005 không có bản cập nhật TLS 1.2. Chính sách của hệ điều hành áp dụng ở cả client và server. Hạ yêu cầu mã hóa có thể vẫn thất bại ngay ở login và làm lộ dữ liệu sau login. Windows Authentication chỉ xác định danh tính, không chữa được lỗi transport. Không giả định TLS 1.1 dùng được với server cũ. [Vòng đời](https://learn.microsoft.com/en-us/lifecycle/products/microsoft-sql-server-2005) · [KB3135244](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/connect/tls-1-2-support-microsoft-sql-server)

| Thành phần | Bằng chứng cho SQL 2005 | Hệ quả cho StartupBot |
|---|---|---|
| SQL Native Client 2005 | Driver cùng đời, ODBC/OLE DB. | Chỉ nghiên cứu trong image có quyền sử dụng, đúng OS/x86/x64. [Lịch sử driver](https://learn.microsoft.com/en-us/sql/connect/connect-history) |
| SNAC 10 | Công bố Feature Pack SQL 2008 nêu đích 2000, 2005 và 2008. | Chứng cứ tương thích lịch sử. Bản vá TLS ở client không bổ sung TLS cho server. [Feature Pack](https://www.microsoft.com/en-us/sql-server/blog/2008/10/18/sql-server-2008-feature-pack-released/) |
| SNAC 11 | Chính sách Microsoft liệt kê 2008, R2, 2012, 2014 và Azure SQL Database. | Không chứng nhận 2005 từ danh sách này. SNAC đã deprecated, ngoại lệ hỗ trợ khi đi kèm một số bản engine có phạm vi riêng. [Chính sách SNAC](https://learn.microsoft.com/en-us/sql/relational-databases/native-client/applications/support-policies-for-sql-server-native-client?view=sql-server-ver15) |
| Microsoft ODBC 11 | Bảng lịch sử có 2005, có Windows 7/Server 2012, ô Win10/11 trống. | Hỗ trợ mở rộng ODBC 11 đã kết thúc 09/07/2024. Chỉ là ứng viên tái lập lịch sử. [Vòng đời ODBC](https://learn.microsoft.com/en-us/sql/connect/odbc/support-lifecycle) [Ma trận lưu phiên bản](https://github.com/MicrosoftDocs/sql-docs/blob/8ee7f72294c258d7290d17ce32137a6401ea4640/docs/connect/odbc/windows/system-requirements-installation-and-driver-files.md) |
| Microsoft ODBC 17/18 | Các hàng 17.x và 18.x trong bản lưu có cột 2005 trống. 17 mặc định không yêu cầu mã hóa toàn kết nối, 18 mặc định yêu cầu. | Luôn yêu cầu mã hóa và kiểm chứng chuỗi/tên chứng chỉ cho TCP. Không thử lại với TrustServerCertificate hoặc driver cũ khi bắt tay thất bại. [Khác biệt ODBC](https://learn.microsoft.com/en-us/sql/connect/odbc/major-version-differences) |
| Node / Electron | Tedious công bố hỗ trợ TDS cho SQL 2000–2022, đánh dấu deprecated cho 7.1 từ v20.1.0. node-mssql có đường Tedious và native msnodesqlv8. | Hỗ trợ protocol của thư viện chưa chứng minh TLS của Node, Windows SSPI, ABI Electron hay kiến trúc ODBC. Với Integrated Authentication đánh giá native adapter dùng token của người dùng, không thay bằng yêu cầu nhập mật khẩu domain. [Tedious](https://tediousjs.github.io/tedious/) · [node-mssql](https://tediousjs.github.io/node-mssql/) |

Client x64 cần driver x64 trong cùng tiến trình. Server có thể x86 ở máy khác. Helper x86 có chi phí riêng cho đóng gói, ký, cập nhật, IPC và kiểm thử. Windows 10/11 cài được driver hiện đại không chứng minh có thể cài engine hoặc SNAC đời cũ. Định danh hệ điều hành client và server độc lập. Chặn tự cài bộ cài legacy, đổi Schannel, bỏ kiểm tra chứng chỉ, mở firewall hay lộ SQL ra Internet. [Ma trận Windows/engine](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/install/windows/use-sql-server-in-windows) · [Driver Windows](https://learn.microsoft.com/en-us/sql/connect/odbc/windows/system-requirements-installation-and-driver-files)

## Sổ kiểm thử legacy

Hàng dưới đây là **đề cương thí nghiệm**. Cột SQL mô tả mục tiêu theo tài liệu hãng, SQL thực tế của khách hàng hiện UNKNOWN cho tất cả. OS, driver và auth là điều kiện cần chuẩn bị. D = discovery thực trên tổ hợp đó, I = xác thực schema và doanh nghiệp, R = đọc có đối chiếu phần mềm gốc. D/I/R đều chưa đạt trên các tổ hợp này. “Dự kiến” là kết quả suy luận. Chưa có lỗi ODBC thực đo trên SQL legacy.

| Vendor / build | SQL mục tiêu | OS client / server, kiến trúc | Driver / auth | Connectivity / encryption | D/I/R, lỗi thực đo | Bằng chứng và quyết định |
|---|---|---|---|---|---|---|
| Chưa xác định | 2000 | UNKNOWN / VM lịch sử x86 | SNAC 10 / Windows hoặc SQL theo giấy phép | Local-only, chưa thử | —/—/—, chưa đo | TDS 7.1, discovery/export. |
| Smart Pro 5.0 | 2005 Express và Standard, default/named | Win11 x64 / VM legacy x86 hoặc x64 được cấp phép | ODBC 18 / Windows, sau đó tài khoản SQL riêng | TCP yêu cầu TLS 1.2 | —/—/—, dự kiến bị chặn | Hãng ghi nhận 2005. Chỉ kiểm chứng từ chối an toàn. |
| Smart Pro 5.0 / FA11 | 2005 | VM Win7 phù hợp vòng đời lịch sử / server cô lập | ODBC 11 đúng bitness / Windows và SQL | Local shared memory nếu driver thực sự hỗ trợ và transport kiểm chứng | —/—/—, chưa đo | Giả thuyết lab. Cần cách ly, phê duyệt và so sánh báo cáo. |
| eBH Pro đời tài liệu cũ | 2008 R2 | Win10 x64 / server và KB phải xác định | ODBC 17.3 / Windows | Named instance, port xác nhận, TLS 1.2 | —/—/—, chưa đo | Thử trên đơn vị giả. |
| SME 2022/2023 | 2008 R2, 2012 và 2014 từng lần | Build Windows và kiến trúc UNKNOWN | Driver theo bảng trên / Windows + SQL | Local và TCP có chứng chỉ | —/—/—, chưa đo | Thiếu lab vendor. |
| Mimosa 2025 | 2008 | UNKNOWN / server thử đúng build | ODBC 17.3 / auth UNKNOWN | Named hoặc default, TLS phụ thuộc KB | —/—/—, chưa đo | Cần xác minh mã đơn vị và quyền. |

Khi chạy, ghi riêng mỗi tổ hợp gồm build vendor, edition/SP/CU, ProductVersion và compatibility level, OS hai phía, driver DLL/version/architecture, transport và auth đã thương lượng, kết quả D/I/R, SQLSTATE/native code đã lọc, commit, fixture, ngày, quyền và tổng đối chiếu. Chỉ ghi ID test đã ẩn danh. Bản tóm tắt này không cấp quyền chạy các tổ hợp.

## Khi nào cho đọc dữ liệu

1. Khóa đích vào grant đúng công ty, niên độ và database. Xác nhận metadata bằng truy vấn tĩnh chỉ lấy ProductVersion, edition và tên DB hiện tại. Nhánh phiên bản chưa biết dừng ở metadata. Tên DB, đường dẫn MDF, tên instance và compatibility level riêng lẻ đều chưa đủ.
2. Trước go-live, DBA xác nhận login chỉ có CONNECT và SELECT trên đúng view. Kiểm quyền hiệu lực, role cấp server/database, owner, grant theo nhóm, impersonation và truy cập liên DB. Nếu không chứng minh được quyền tối thiểu, chặn. Chỉ thực hiện nghiệm thu denial với fixture hy sinh được. ApplicationIntent=ReadOnly, transaction rollback hoặc tên hàm không tạo ra ranh giới quyền.
3. Adapter versioned có fingerprint bảng/cột/kiểu và đối chiếu mã doanh nghiệp, niên độ do người dùng chọn với phần mềm gốc. Catalog truy vấn chỉ có ID, tham số kiểu hóa, giới hạn cột/dòng/byte, thời gian và hủy. Tránh NOLOCK cho đối chiếu kế toán. Không chạy SQL tự do, procedure, DDL hay thay đổi isolation của server.
4. Kiểm thử varchar/text theo code page, nvarchar/ntext tiếng Việt, ký tự tổ hợp, TCVN3 bằng bản xuất có tác giả xác nhận. Giữ giá trị gốc khi chưa xác định bảng mã. Decimal truyền chuỗi có precision/scale hoặc decimal chính xác. Giữ số 0 đầu mã số thuế, SKU và chứng từ. DateTime giữ ngày nghiệp vụ và quy ước múi giờ. Không qua JS Number cho số tiền hay mã dài. Kiểm biên âm, chiết khấu, trùng chứng từ khác năm và quy tắc làm tròn của hãng.
5. SQL 2005 thiếu DATE, DATETIME2, OFFSET/FETCH, TRY_CONVERT, STRING_AGG. Dùng mẫu truy vấn riêng cho từng mức tương thích, TOP có thứ tự khóa ổn định và tham số bind. Đối chiếu số dòng, số dư đầu/kết kỳ, tổng theo thuế suất và từng dòng mẫu trong cùng kỳ chốt. Nếu báo cáo gốc chênh hoặc thay đổi trong lúc đọc, đánh dấu chưa đối chiếu và dừng phát hành.
