# Sử dụng nguồn cục bộ

Người dùng nói mục tiêu bằng tiếng Việt. Bot tự tạo job JSON trong thư mục hồ sơ riêng đã được phép ghi. Tệp cấu hình, bản trích và báo cáo có thể chứa định danh thật. Đặt chúng trong thư mục của người dùng được bảo vệ bằng ACL, ngoài Git, OneDrive và thư mục chia sẻ. Chọn tên đầu ra mới mỗi lần. Giữ riêng nguồn và hồ sơ của từng khách hàng.

## SQL MISA

Trên Windows, dùng Windows PowerShell 5.1 sẵn có với quyền thực thi đã được broker/host cấp. Quyền đọc một file hay việc kích hoạt skill không cho phép chạy chương trình. Khi đã có hồ sơ được quản trị viên xác nhận, tự dùng lại hồ sơ tương ứng. Gợi ý đặt tại `%LOCALAPPDATA%/StartupBot/Audit/profiles/`; chỉ dùng đúng profile người dùng đã duyệt. Không tự tạo profile từ tên database gần giống hãng.

Hồ sơ JSON có các chuỗi `instance`, `database`, `branch` (GUID), `company` (bí danh nội bộ), `reader` (danh tính Windows do ORIGINAL_LOGIN trả về). Quản trị viên xác nhận trước khi cấp profile: MISA SME 2026 R7, database và BranchID khớp đơn vị làm việc; tài khoản Windows chuyên đọc, quyền SQL giới hạn đúng dữ liệu được duyệt, kể cả quyền kế thừa và truy cập database khác. Bảo vệ profile khỏi sửa ngoài ý muốn. Các kiểm tra lúc kết nối là hàng rào bổ sung, không chứng minh toàn bộ phân quyền liên công ty. Profile không chứa mật khẩu. Nếu chưa có quyền phù hợp, vẫn xử lý bản xuất đã duyệt.

~~~powershell
powershell.exe -NoProfile -NonInteractive -File "<skill-root>/scripts/misa-sales.ps1" -Profile "<profile.json>" -Month "2026-08" -OutFile "<sales.xml>"
~~~

Bộ đọc dùng Windows Authentication và shared memory cục bộ đến named instance đã duyệt, kiểm SQL Server major 15, principal và quyền hiệu lực, kiểm hai cột tiền decimal(18,4). Truy vấn cố định có tham số, lọc một BranchID, PostedDate trong tháng và IsPostedFinance=1. Giao dịch đọc nhất quán có thời hạn lệnh 10 giây, chờ khóa 3 giây, tối đa 20.000 phiếu. Nếu máy quá tải, dừng và báo; ưu tiên bản sao được duyệt. XML lưu RefID, số phiếu, ngày hạch toán, tổng tiền hàng đầu phiếu, tổng dòng và số dòng. Phiếu không có chi tiết có detailRows=0 và detailAmount trống; tìm riêng để soát xét. Thuế, chiết khấu, ngoại tệ, sổ 511, kho, mua hàng và BHXH cần nguồn/adapter tương ứng. Không tự mở rộng SELECT trên server. SQL 2005, LAN, MISA ASP/AMIS và build khác chưa được xác minh cho bộ đọc này.

## Excel, XML và báo cáo

Dùng `scripts/audit.ps1` trên Windows PowerShell 5.1 hoặc pwsh. Lệnh chỉ in mã trạng thái; dữ liệu chi tiết đi vào file chỉ định. Đọc báo cáo bằng phép chọn trường cục bộ trước khi trả chat. Không in toàn bộ file.

~~~powershell
powershell.exe -NoProfile -NonInteractive -File "<skill-root>/scripts/audit.ps1" -JobFile "<job.json>" -OutFile "<bao-cao-moi.json>"
~~~

1. Tự chạy `{"op":"inspect","left":{"path":"<path.xlsx>"}}` để lấy tên sheet hiện, hoặc đưa đường dẫn XML để liệt kê đường dẫn phần tử/số lần xuất hiện. Sau khi chọn sheet hoặc recordPath, chạy inspect với phạm vi đó để đọc tiêu đề và hash. Với báo cáo nhiều dòng tiêu đề, chọn đúng headerRow và lastRow để tách chân báo cáo. Trị số tổng cuối bảng cần lưu làm tổng kiểm soát riêng. Ghi nhận dòng đầu/cuối đã chọn.
2. Ánh xạ tên trường thực tế thành company, period, key, amount và các trường bổ sung. So sánh khóa nguyên văn (phân biệt hoa thường), không bỏ số 0 đầu. Nếu cùng số phiếu có thể thuộc nhiều loại/chi nhánh, giới hạn thêm scope hoặc dùng khóa đã xác minh ở cả hai nguồn. Nhiều dòng cùng key được cộng và đánh dấu kiểm tra cấp độ chi tiết. Một mã tìm khớp không tự chứng minh cùng một giao dịch.
3. Khi một file chỉ chứa một đơn vị và không có cột company, phải kiểm bằng chứng đầu báo cáo/siêu dữ liệu/bộ lọc do người có quyền xác nhận. Có thể gắn phạm vi bằng `"bind":{"company":"CT-DEMO"},"sha256":"<hash từ inspect>","evidence":"<tham chiếu bằng chứng cục bộ>"` trên nguồn và bỏ company khỏi fields. Tương tự cho kỳ hoặc chi nhánh. Không gắn theo tên file hay gắn phạm vi đơn vị/kỳ đơn cho file tổng hợp chưa xác định.
4. period là chuỗi khớp trực tiếp, hoặc ánh xạ cột ngày và dùng periodFormat là yyyy-MM-dd, dd/MM/yyyy hay excel-date (ô ngày Excel dạng số nguyên, có xét hệ ngày 1900/1904). Số tiền dạng văn bản chấp nhận dấu thập phân khai báo, không chấp nhận dấu nhóm, số mũ, ô trống hay tự làm tròn; tối đa 18 chữ số nguyên và 6 chữ số lẻ. Số Excel vượt 15 chữ số có nghĩa cần xuất lại kiểu văn bản. Sổ nhiều loại tiền phải lọc đúng loại tiền hoặc nguồn đã xác minh cùng đơn vị tiền.
5. XML chọn recordPath tuyệt đối và namespace URI nếu có. fields có thể trỏ tới đường dẫn con như TTChung/SHDon hoặc chọn bản ghi dòng hàng. Với hóa đơn có nhiều dòng, không cộng tổng hóa đơn lặp theo từng dòng. Mã người bán, ký hiệu, số hóa đơn và trạng thái điều chỉnh phải đủ để ghép; khi không có khóa tương ứng, báo thiếu. XML có DTD, workbook có công thức trong vùng chọn, liên kết ngoài hoặc macro cần bản xuất giá trị phù hợp. Trang nhiều header, ô gộp trong vùng dữ liệu, .xls nhị phân, PDF ảnh hoặc một XML nhiều namespace phức tạp cần ánh xạ/chuyển đổi bảo toàn trước. Không suy đoán schema.
6. Dùng sourceRows, scopedRows, selectedRows, tổng kiểm soát, số khóa, số ngoại lệ và hash trong giấy làm việc. Với bản XML MISA rỗng, dùng thuộc tính count và khoảng kỳ của bản trích để ghi nhận nguồn rỗng; truy vấn file yêu cầu recordPath có bản ghi. Với báo cáo kết quả trả từ hai bản cùng nguồn, đánh dấu đối chiếu nội bộ.

Ví dụ job đối chiếu đầu phiếu với tổng dòng trên bản trích MISA, cùng đơn vị, kỳ, sổ và chi nhánh. Bot điền đường dẫn và GUID từ hồ sơ đã duyệt:

~~~json
{
  "op": "compare",
  "scope": {"company":"CT-DEMO","period":"2026-08","book":"finance","branch":"11111111-1111-4111-8111-111111111111"},
  "left": {"path":"<sales.xml>","recordPath":"/sales/row","fields":{"company":"company","period":"period","book":"book","branch":"branch","key":"id","amount":"amount"}},
  "right":{"path":"<sales.xml>","recordPath":"/sales/row","fields":{"company":"company","period":"period","book":"book","branch":"branch","key":"id","amount":"detailAmount"}}
}
~~~

Để đối chiếu Excel với XML, thay right bằng path, sheet, headerRow, fields của Excel và chọn một khóa chung đáng tin cậy. Để tìm, dùng op=find, chỉ left, thêm `"where":[{"field":"key","op":"equals","value":"00017"}],"select":["key","amount"]`. `contains` tìm chuỗi con; `above` và `below` so thập phân chính xác (giá trị ngưỡng là chuỗi dấu chấm). Các điều kiện kết hợp bằng AND và áp dụng cả hai phía nếu dùng compare. `total` trả số dòng và tổng đã lọc; `compare` trả khóa chỉ có bên trái/phải, chênh hai phía và trường hợp nhiều dòng cần xem lại. Với câu hỏi tùy biến như phân nhóm nhiều chiều, xếp hạng, kiểm khoảng ngày hay kiểm khóa ghép, dùng công cụ phân tích cục bộ của host trên bản trích được phép, giữ DECIMAL và khóa dạng text. Mô tả và lưu phép tính cùng phạm vi; không đưa hàng dữ liệu doanh nghiệp vào lịch sử Data/chat dùng chung. Khi host không cung cấp runtime hoặc quyền phù hợp, ghi giới hạn và chỉ dùng nguồn mà host cho phép.

Đối chiếu thêm các cột chữ bằng compareFields, ví dụ `"compareFields":["account","currency"]` sau khi ánh xạ các cột ở cả hai nguồn. Chỉ kết luận từng trường khi mỗi bên có đúng một dòng cho khóa. Có thể thêm `"keyFields":["series","type"]` để ghép theo bộ khóa key, series, type mà vẫn giữ số 0 đầu. Không có sai biệt khi hai tổng bằng nhau nhưng khóa có nhiều dòng vẫn phải soát xét cấp độ chi tiết. Báo cáo đầy đủ lưu tại máy, stdout chỉ nêu trạng thái và số lượng.

Khi người dùng yêu cầu báo cáo, đặt OutFile có đuôi .html để nhận giấy làm việc tiếng Việt, mở cục bộ bằng trình duyệt và in được. Bản .json phục vụ xử lý tiếp. Tên nguồn trong báo cáo dùng A/B; kèm file job đã lưu riêng để người soát xét lần ngược tới nguồn. Không đưa file HTML có dữ liệu chi tiết lên dịch vụ xuất bản.
