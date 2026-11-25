# HyperFrames: kiểm tra tạo video trong StartupBot

Ngày 25-11-2026, dùng server và thư mục dữ liệu cách ly, skill HyperFrames của nhánh này và thuê bao ChatGPT đã được người dùng cho phép. Bài thử yêu cầu một quảng cáo dọc 10–15 giây cho quán cà phê giả định, tự tạo kịch bản, thoại tiếng Việt, phụ đề, không dùng dịch vụ trả phí hoặc truy cập ngoài.

## Kết quả lần đầu

StartupBot tạo ba cảnh minh họa phẳng và xuất MP4 11,5 giây, 1080 × 1920, H.264 và AAC. Đã xem ba khung hình và ảnh tổng hợp một khung mỗi giây: bố cục có chủ ý nhưng nội dung thị giác đơn giản, chuyển động ít, chưa đủ bằng chứng đạt chất lượng quảng cáo cao cấp. Chưa nghe duyệt phát âm hoặc xem toàn bộ video ở tốc độ bình thường.

CLI `check` báo runtime không sẵn sàng; AI bỏ qua renderer HyperFrames và dùng Puppeteer với FFmpeg để tạo MP4. Do đó MP4 đầu tiên không chứng minh render HyperFrames thành công. Trong bước kiểm tra, CLI tự tải font từ Google Fonts dù yêu cầu ngoại tuyến; AI đã báo sự cố này.

## Tái hiện và sửa độc lập

Trên bản sao cách ly, HyperFrames CLI 0.9.88 thất bại ở `snapshot` sau 45 giây với `window.__player` chưa được thiết lập. Bổ sung cấu trúc HTML đầy đủ vào cùng tệp thì `snapshot` thành công. Các đối chứng chỉ thêm `hyperframes.json` hoặc chỉ thêm `data-start` vẫn thất bại; trường hợp chỉ thêm cấu trúc HTML thành công. CLI sau đó render MP4 11,5 giây bằng HyperFrames với H.264, AAC, 1080 × 1920 và 24 fps. Đây là sửa thủ công trên bản sao, không phải kết quả của lần chạy StartupBot đầu tiên.

Tệp phông cục bộ khai báo qua `@font-face` không gây yêu cầu tải phông trong tiến trình Node khi thử với cache rỗng và chặn `fetch` ngoài localhost. Bản đối chứng không khai báo phông tạo hai yêu cầu tới Google Fonts và bị bộ chặn từ chối. Bộ chặn này không chứng minh mọi kết nối của Chrome hoặc toàn bộ hệ điều hành đều bị chặn; không khẳng định kiểm thử hoàn toàn ngoại tuyến.

Skill đã được bổ sung hướng dẫn giữ các thẻ HTML cần thiết, dùng `@font-face` cục bộ cho yêu cầu ngoại tuyến và không tự khẳng định đã cách ly mạng khi chưa kiểm chứng. Hướng dẫn này chưa phải cơ chế chặn mạng bắt buộc trong ứng dụng. Các thử nghiệm và giới hạn còn lại phải được kiểm tra trong bản app đóng gói và trên Windows/Linux.

Trong CLI 0.9.88, `init --example product-promo` cố tải tệp từ GitHub; với bộ chặn thử nghiệm nó thất bại. Hướng dẫn đã được sửa để dùng `blank` có sẵn khi yêu cầu ngoại tuyến và không thử tải mẫu hoặc danh mục từ xa.

## Lần chạy StartupBot thứ hai

Với hướng dẫn HTML và phông mới, AI tạo dự án bằng mẫu `blank`, dùng phông cục bộ và áp dụng sandbox macOS chặn mạng. Trong bài thử này `check` thất bại, Chrome thoát với `SIGTRAP` khi HyperFrames render trong sandbox, và AI lại xuất video bằng Playwright/FFmpeg. MP4 12 giây, 720 × 1280 có ba cảnh vector đơn giản; ảnh tổng hợp vẫn chưa cho thấy chất lượng quảng cáo cao cấp. Chưa nghe trực tiếp lời thoại.

Một phép thử độc lập trên chính dự án cách ly đó cho thấy HyperFrames render được khi đặt `HYPERFRAMES_CHROME_SANDBOX=0` bên trong sandbox mạng, nhưng tùy chọn này tắt sandbox của Chrome, làm giảm bảo vệ khi mở nội dung không tin cậy. Đây chỉ là thí nghiệm chẩn đoán, không phải thay đổi cấu hình ứng dụng hay một giải pháp an toàn được xác nhận để phát hành. Cần tìm và kiểm chứng phương án chặn mạng tương thích với sandbox của Chrome, và làm rõ trong câu trả lời khi renderer dự phòng được dùng.

## Tài nguyên thiết kế được phục hồi

Đã đối chiếu Git blob của 13 tài liệu `FRAME.md` với commit HyperFrames đã ghim và phục hồi chúng để trợ lý có thêm hướng thiết kế. Sáu tệp font của mẫu `code-editorial` và ba thông báo SIL Open Font License 1.1 đi kèm cũng khớp Git blob nguồn và được giữ nguyên. Các trang showcase và caption skin chưa được phục hồi; đây là tài liệu thiết kế chứ chưa phải bộ mẫu dựng video hoàn chỉnh. Kết quả thẩm mỹ thực tế sau thay đổi này vẫn cần được thử lại trong StartupBot.

## Lần chạy StartupBot thứ ba

Sau khi khôi phục tài liệu thiết kế và bổ sung hướng dẫn báo đúng renderer, bài thử tương tự tạo MP4 12 giây, 720 × 1280 qua Sharp và FFmpeg. Lần này trợ lý đã nêu rõ HyperFrames không kiểm tra được hình và đã dùng công cụ dự phòng. Ảnh tổng hợp một khung mỗi giây vẫn cho thấy ba cảnh vector đơn giản gần giống các lần trước, không đủ để khẳng định chất lượng quảng cáo cao cấp. Chưa nghe trực tiếp lời thoại, chưa kiểm chứng video chuyển động ở tốc độ bình thường. Việc bổ sung tài liệu và thay đổi hướng dẫn chưa chứng minh giải quyết được chất lượng sáng tạo.
