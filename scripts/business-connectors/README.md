# Kiểm kê cục bộ trong phòng thử nghiệm

Công cụ dành cho kỹ sư đánh giá Discovery Engine. Trong checkout tin cậy của một máy Windows thử nghiệm đã được phép kiểm kê, dùng Node 24 của môi trường phát triển.

```powershell
node scripts/business-connectors/inspect-local.ts --inspect-local
```

Đầu ra JSON nằm trên stdout cục bộ. Tên instance có thể chứa tên doanh nghiệp. Chỉ chia sẻ sau khi ẩn danh. Không đưa đầu ra nguyên bản vào hội thoại, ticket hay log chung. Mã thoát 0 là đã đọc được các nguồn đã định, 2 là một phần nguồn bị lỗi hoặc vượt giới hạn, 1 là từ chối hoặc không thu được bản kiểm kê hợp lệ. Máy trạm có thể dùng server khác ngay cả khi danh sách instance rỗng.

Collector dùng Windows PowerShell 5.1, registry HKLM/HKCU và Service Control Manager theo quyền người gọi. PowerShell phải được chính sách của máy cho phép chạy file đã kiểm tra. Thời hạn 30 giây, giới hạn stdout 512 KiB. Chỉ dùng tên dịch vụ, ánh xạ instance, phiên bản Setup, tên driver ODBC và các dấu vết ứng dụng trong danh sách cho phép. Phiên bản Setup có thể cũ hơn bản vá engine. Phiên bản ODBC 17/18 từ tên đăng ký chỉ là major. LocalDB chỉ có thể được ghi nhận ở mức runtime. Tên cài đặt ứng dụng là gợi ý, chưa liên kết với database. Tên instance ngoài tập ký tự được nhận diện làm giảm mức bao phủ.

Kết quả có `connection: "untested"` trong mọi trường hợp. Công cụ chưa được gắn vào MCP, Skills, menu hay bộ cài khách hàng. Không có hoạt động mạng, truy vấn SQL hoặc thay đổi cấu hình.

Chạy lại fixture đa nền tảng bằng `node --test scripts/business-connectors/discovery.fixture.ts`. Workflow **Windows business discovery** còn đối chiếu kết quả của CLI với Service Control Manager trên runner Windows dùng một lần. Bằng chứng này chỉ áp dụng cho các nguồn mà runner có.

## Phòng thử compatibility

Chạy cả hai bộ fixture bằng `node --test scripts/business-connectors/*.fixture.ts`. Bộ thứ hai phân loại metadata engine và SQLSTATE/native code tổng hợp. Không suy ra quyền truy cập từ generation hay compatibility level của DB.

Trên GitHub-hosted Windows runner, workflow còn tạo các khóa registry giả dưới HKCU để kiểm đường đọc kiểu SQL 2000 và 2005. Sau đó, nếu runtime LocalDB có sẵn, tạo instance tên ngẫu nhiên dành riêng cho lần chạy, mở Windows Integrated Authentication, kiểm transport cục bộ, chạy một SELECT cố định và xóa instance trong finally. Các giá trị decimal có scale, mã số 0 đầu và tiếng Việt được đối chiếu sau khi truyền tới Node. Đây là phiên LocalDB thuộc tài khoản dựng fixture. Chứng minh phân quyền read-only, TCP/TLS, dữ liệu của phần mềm gốc và hệ thống SQL 2005 thật cần các thí nghiệm khác.

## Quyền đọc và Setup Assistant trong lab

Bài thử LocalDB tạo hai database tổng hợp A/B trong đúng instance dùng một lần. Connection riêng vào A chuyển sang database user chỉ có SELECT trên một view bằng EXECUTE AS USER WITH NO REVERT. Kiểm việc đọc trực tiếp bảng, đọc B, ghi và đọc sau thu hồi đều bị SQL Server từ chối. Một giao dịch ở connection chủ tạo tranh chấp khóa để kiểm command timeout. Đây là bằng chứng phân quyền cấp database trong lab; cần kiểm login/SSPI thực của khách hàng, TLS, credential store và broker của desktop trước khi cho agent kết nối.

Lệnh sau chỉ đọc JSON từ stdin rồi in kế hoạch. Các giá trị phải là bằng chứng cho cùng một endpoint. Chỉ dùng observedVersion cho engine đích, không lấy phiên bản LocalDB trên máy trạm để gán cho máy LAN. Trạng thái unknown là hợp lệ và ngăn suy diễn việc cần cài.

~~~sh
echo '{"consent":"granted","data":"sql","location":"local","engine":"running","observedVersion":"9.00.5000","access":"unknown","driver":"unknown","channel":"unknown","database":"unknown","vendor":"unknown","installation":"unknown"}' | node scripts/business-connectors/plan-setup.ts --dry-run
~~~

Các trường checks của phương án F ghi kết quả kiểm tra do người vận hành cung cấp. Công cụ không tải, xác minh hay chạy installer, không nhận password và không xin nâng quyền. Bundle thử dùng file xuất ngay cả khi người dùng chưa có môi trường SQL.

Đối với Smart Pro dùng SQL Server 2005, Setup Assistant có [quy trình cài thủ công trong VM cô lập](../../docs/startupbot/business-connectors/smartpro-sql2005-lab.md), gồm kiểm tra media, điểm dừng và phép đọc sau cài.

## Pilot API MISA ASP Kế toán

Trên Node 24+, kỹ sư có thể dựng một đề nghị chi tạm ứng tiền mặt VND bằng API cục bộ `prepareAdvance(input)` hoặc bằng lệnh sau. Tham số trong ví dụ là dữ liệu tổng hợp. Mã nguồn gọi phải giữ nguyên reference khi chạy lại cùng nghiệp vụ.

~~~sh
echo '{"company":"DEMO","branch":"00000000-1111-4444-aaaa-000000000001","employee":"00000000-1111-4444-aaaa-000000000002","reference":"00000000-1111-4444-aaaa-000000000003","number":"00017","date":"2026-11-18","amountVnd":"1000000","debit":"141","credit":"1111"}' | node scripts/business-connectors/asp/cli.mjs prepare
~~~

Lệnh prepare chạy offline, xuất JSON ra stdout cục bộ. Số tiền là chuỗi nguyên dương VND biểu diễn được chính xác bằng số nguyên an toàn của JavaScript. Chọn tài khoản lá, đối tượng và kỳ từ danh mục của công ty thực hành. Các mã GUID của ví dụ chỉ phục vụ kiểm thử.

Lệnh `submit-demo` nhận cùng JSON qua stdin. Chỉ chạy khi đã có ClientID hợp lệ cho sản phẩm ASP, mã kết nối thuộc dữ liệu thực hành và callback đã đăng ký. Cung cấp qua môi trường cục bộ của tiến trình: `ASP_CLIENT_ID`, `ASP_ACCESS_CODE`, `ASP_DEMO_COMPANY`, `ASP_DEMO_BRANCH`. Hai biến cuối phải khớp công ty phía ứng dụng và GUID chi nhánh trong đề nghị. Công ty thực hành phải được người vận hành xác nhận: gateway dùng chung, các biến này không tự nhận biết sổ production. Theo [đặc tả ASP trên Developer Portal](https://developer.misa.vn/products-openapi/ASP), ClientID được cấp khi yêu cầu đăng ký sản phẩm được phê duyệt. Phiên Chrome đã đăng nhập chưa cung cấp ClientID cho StartupBot.

Client gọi `/asp/v1/token` rồi `/asp/v1/save` trên gateway của Developer Portal. Kết quả `queued` chỉ xác nhận gateway tiếp nhận. Công cụ chưa nhận callback hoặc kiểm tra bút toán trên sổ. Mã `needs_reconciliation` yêu cầu kiểm lại trên ASP trước khi gửi tiếp. Nhật ký cục bộ trong `~/.startupbot/asp-pilot` lưu hash, trạng thái và ngăn gửi lại cùng mã trên cùng máy với cùng thư mục. Dùng một máy gửi cho mỗi pilot. Việc xóa nhật ký hoặc tạo reference mới sẽ mất khả năng nhận diện lượt gửi trước.

Kiểm thử: `node --test scripts/business-connectors/asp/advance.fixture.mjs`.
