# Cài SQL Server 2005 cho pilot Smart Pro

Năng Động liệt kê SQL Server 2005 trong cấu hình máy chủ Smart Pro 5.0, cùng các lựa chọn 2008, 2012 và 2014. Bản build Smart Pro, phiên bản Windows, kiến trúc x86/x64 và edition cần được xác nhận cho từng ca. Mục tiêu pilot đầu tiên là cài được đúng Database Engine 9.x, mở công ty demo và đối chiếu được một báo cáo cùng kỳ. [Cấu hình máy chủ của Năng Động](https://phanmemnangdong.com/yeu-cau-he-thong-may-tinh-cau-hinh-may-cai-phan-mem-smart-pro-5-0/)

## Chọn đúng máy

- **Smart Pro đang dùng được.** Xem tên máy chủ và instance trên màn hình đăng nhập của Smart Pro. Nếu dữ liệu ở LAN thì giữ nguyên máy trạm và máy chủ. Khi có quyền hãy xác minh phiên bản engine trên đúng máy chủ. Trường hợp này thường không cần cài thêm SQL.
- **Cần tái hiện một bản Smart Pro dùng SQL 2005.** Dùng máy ảo Windows có license, tương thích với bộ cài được chọn. Ghi rõ bản Smart Pro, edition SQL và kiến trúc process. Ngắt card mạng ảo ở hypervisor, tháo thư mục chia sẻ chứa dữ liệu doanh nghiệp, chỉ dùng tài khoản cục bộ và công ty demo. Chụp snapshot trước cài đặt. Người vận hành có thể cài thủ công trong VM khi đủ bằng chứng.
- **Cần cài mới cho doanh nghiệp đang chạy sổ sách.** Đây là quyết định triển khai riêng. Giữ nguyên máy và dữ liệu khi chưa có phép thử tái lập, bản sao phục hồi được và sự đồng ý của người quản trị máy đích.

## Media tìm được cho Express SP4 tiếng Anh

Gói cập nhật KB2463332 trên Microsoft Update Catalog có kèm trình cài Express đầy đủ. Đã kiểm tra hai lớp trực tiếp từ file tải qua HTTPS của Microsoft, không thực thi file. Đường dẫn bên trong CAB là `hotfixexpress/files/sqlexpr.exe`. Tệp con chứa `setup.exe` và `setup/sqlrun_sql.msi`; metadata PE ghi Microsoft SQL 2005 Server Express Edition, build `9.00.5000.00`. [Microsoft Update Catalog](https://www.catalog.update.microsoft.com/ScopedViewInline.aspx?updateid=48f7e3b7-2c8f-4900-ae32-f3d8f29c988d) · [Gói gốc do Microsoft lưu trữ](https://catalog.s.download.windowsupdate.com/msdownload/update/software/svpk/2011/01/sqlserver2005expresssp4-kb2463332-x86-enu_896d55b16d7d0978618378f6bbbb3b6ab23296cc.exe)

| Tệp | SHA-256 | Bằng chứng |
|---|---|---|
| KB2463332 ENU, gói ngoài | `62118d3717bfd0dc9866dbbc4d602494f68ff4c94693236b51fa058b193b1b3e` | Khớp SHA-256 công bố trong cửa sổ Download của Catalog. |
| SQLEXPR.EXE, bộ cài phía trong | `087bf7b1d433eed6afcfb2f983dfed3381416edf1e0dc6c7779b98c537f6d5b9` | Tính từ tệp con của gói ngoài đã đối chứng. Chữ ký nhúng của cả hai tệp cho kết quả OK với LIEF và ghi Microsoft Corporation. |

Trên máy Windows hiện đại dùng để chuẩn bị media, chạy [công cụ kiểm file](../../../scripts/business-connectors/lab/verify-sql2005-media.ps1) với `-LiteralPath` trỏ đến SQLEXPR.EXE. Công cụ đối chiếu SHA-256 và yêu cầu Windows tin cậy chữ ký Microsoft theo chính sách hiện hành. Nếu Windows từ chối chữ ký cũ, giữ nguyên chính sách và dừng. Phép kiểm media độc lập với nghiệm thu cài đặt trong VM. Các hash trên chỉ áp dụng cho đúng gói Express SP4 ENU này.

## Bộ cài và thực hiện

1. Lấy media cài mới đúng edition từ nguồn chính thức hoặc bộ gốc được cấp phép có nguồn gốc đối chiếu được. Với Express, kiểm tra tài liệu nêu rõ gói cài mới Database Engine. Catalog Microsoft có cả các gói chỉ nâng cấp instance đã cài. Xác nhận riêng cả service pack và build dự kiến. Microsoft từng công bố SP4 Express; thông báo lịch sử không chứng minh file tải hiện tại còn sẵn. [Microsoft SQL Server Team](https://www.microsoft.com/en-us/sql-server/blog/2010/12/20/sql-server-2005-sp4-rtm-now-available-for-download/) · [Microsoft Update Catalog](https://www.catalog.update.microsoft.com/ScopedViewInline.aspx?updateid=48f7e3b7-2c8f-4900-ae32-f3d8f29c988d)
2. Trên máy Windows hiện đại tin cậy, dùng **Properties → Digital Signatures** để xác minh chữ ký của Microsoft và dấu thời gian. Đối chiếu SHA-256 bằng `Get-FileHash -Algorithm SHA256 -LiteralPath <đường-dẫn-tệp>` với giá trị độc lập của đúng media. Lưu nguồn đối chứng, kết quả xác minh và loại gói. Nếu thiếu bằng chứng hoặc chữ ký không xác minh được, dừng ở bước chuẩn bị. Chuyển đúng media vào VM qua thiết bị chỉ đọc.
3. Trong VM, kiểm tra danh sách SQL services và tên instance còn trống. Mở trình cài đặt tương tác bằng quyền quản trị cục bộ đã được cấp. Chọn Database Engine, instance dành riêng cho pilot (ví dụ `SMARTPROLAB`) và Windows Authentication nếu bản Smart Pro thử nghiệm cho phép. Giữ giao tiếp SQL trong máy. Khi Smart Pro cần cấu hình xác thực riêng, dùng tài khoản lab được cấp và ghi nhận yêu cầu theo build. Khi setup yêu cầu điều kiện ngoài kế hoạch, lưu lỗi setup cục bộ và dừng để kiểm tra. [Trình cài SQL Server 2005 Express của Microsoft](https://learn.microsoft.com/en-us/security-updates/windowsrightsmanagementservices/toinstallmicrosoftsqlserver2005expresseditiontoprovidedatabasesupportforrms)
4. Sau khi cài, xác nhận đúng dịch vụ của instance mới chạy trong VM. Dùng công cụ SQL tương thích đã có trên VM với tài khoản Windows được phép. Với `sqlcmd` hỗ trợ shared memory, ví dụ `sqlcmd -S lpc:.\SMARTPROLAB -E -d master -l 5 -t 10 -b -i verify-sql2005.sql`. Mang [tệp SQL chỉ đọc](../../../scripts/business-connectors/lab/verify-sql2005.sql) vào VM cùng media. Nếu console hiển thị sai dấu, dùng tùy chọn xuất Unicode của công cụ và đối chiếu file kết quả. Ghi phiên bản, service pack, edition và kiểm nguyên văn ba giá trị **Đắk Lắk**, **00017**, **-12345678901234567890.1200**. Đúng cú pháp trên fixture vẫn cần được kiểm lại trên engine 9.x thật.
5. Mở bản Smart Pro demo đã xác định, chọn đúng instance, công ty và kỳ. Đối chiếu số dòng, số chứng từ, tiền âm và phần lẻ với báo cáo xuất từ ứng dụng. Tách kết quả cài engine, chạy phép đọc và đối chiếu Smart Pro thành ba kết quả độc lập. Nếu lỗi, giữ log đã ẩn dữ liệu định danh và phục hồi snapshot.

SQL Server 2005 đã hết hỗ trợ và thiếu TLS 1.2. Giữ nguyên chính sách mã hóa trên máy chủ, máy trạm và host của VM. Pilot dùng shared memory trong VM chỉ kiểm chứng đường kết nối nội bộ. [Vòng đời SQL Server 2005](https://learn.microsoft.com/en-us/lifecycle/products/microsoft-sql-server-2005) · [TLS theo phiên bản SQL Server](https://learn.microsoft.com/en-us/troubleshoot/sql/database-engine/connect/tls-1-2-support-microsoft-sql-server)

## Dùng Setup Assistant

Trong JSON đầu vào của `plan-setup.ts --dry-run`, trường tùy chọn `smartPro2005Lab` chọn nhánh lab. Trên máy kỹ sư có thể bắt đầu với dữ liệu sau. Mỗi giá trị chỉ được đổi sau khi kiểm tra đúng VM và đúng media. File JSON dùng cho chẩn đoán, không chứa credential.

~~~json
{
  "consent": "granted", "data": "sql", "location": "local", "engine": "absent",
  "access": "unknown", "driver": "unknown", "channel": "unknown", "database": "unknown",
  "vendor": "new-required", "installation": "requested",
  "checks": {},
  "smartPro2005Lab": {}
}
~~~

`LAB_2005_PENDING` liệt kê bằng chứng còn thiếu trong `missing`. Nhóm `smartPro2005Lab` ghi `disposableVm`, `networkDisconnected`, `cleanSnapshot`, `syntheticDataOnly` và `smartProBuildConfirmed`. Các điều kiện còn lại thuộc `checks`. Khi đã kiểm tra đầy đủ, `LAB_2005_MANUAL` hướng dẫn người vận hành mở trình cài trong VM. Các giá trị do người vận hành xác nhận; planner chỉ đọc JSON, không có khả năng xác minh hypervisor hay khởi chạy bộ cài. Kết quả chạy thật cần lưu phiên bản Windows, driver/bitness, edition/build SQL, bản Smart Pro và báo cáo đối chứng.
