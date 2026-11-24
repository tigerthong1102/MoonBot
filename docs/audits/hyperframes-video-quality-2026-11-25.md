# HyperFrames: kiểm tra tạo video trong StartupBot

Ngày 25-11-2026, dùng server và thư mục dữ liệu cách ly, skill HyperFrames của nhánh này và thuê bao ChatGPT đã được người dùng cho phép. Bài thử yêu cầu một quảng cáo dọc 10–15 giây cho quán cà phê giả định, tự tạo kịch bản, thoại tiếng Việt, phụ đề, không dùng dịch vụ trả phí hoặc truy cập ngoài.

## Kết quả lần đầu

StartupBot tạo ba cảnh minh họa phẳng và xuất MP4 11,5 giây, 1080 × 1920, H.264 và AAC. Đã xem ba khung hình và ảnh tổng hợp một khung mỗi giây: bố cục có chủ ý nhưng nội dung thị giác đơn giản, chuyển động ít, chưa đủ bằng chứng đạt chất lượng quảng cáo cao cấp. Chưa nghe duyệt phát âm hoặc xem toàn bộ video ở tốc độ bình thường.

CLI `check` báo runtime không sẵn sàng; AI bỏ qua renderer HyperFrames và dùng Puppeteer với FFmpeg để tạo MP4. Do đó MP4 đầu tiên không chứng minh render HyperFrames thành công. Trong bước kiểm tra, CLI tự tải font từ Google Fonts dù yêu cầu ngoại tuyến; AI đã báo sự cố này.

## Tái hiện và sửa độc lập

Trên bản sao cách ly, HyperFrames CLI 0.9.88 thất bại ở `snapshot` sau 45 giây với `window.__player` chưa được thiết lập. Bổ sung cấu trúc HTML đầy đủ vào cùng tệp thì `snapshot` thành công. Các đối chứng chỉ thêm `hyperframes.json` hoặc chỉ thêm `data-start` vẫn thất bại; trường hợp chỉ thêm cấu trúc HTML thành công. CLI sau đó render MP4 11,5 giây bằng HyperFrames với H.264, AAC, 1080 × 1920 và 24 fps. Đây là sửa thủ công trên bản sao, không phải kết quả của lần chạy StartupBot đầu tiên.

Tệp phông cục bộ khai báo qua `@font-face` không gây yêu cầu tải phông trong tiến trình Node khi thử với cache rỗng và chặn `fetch` ngoài localhost. Bản đối chứng không khai báo phông tạo hai yêu cầu tới Google Fonts và bị bộ chặn từ chối. Bộ chặn này không chứng minh mọi kết nối của Chrome hoặc toàn bộ hệ điều hành đều bị chặn; không khẳng định kiểm thử hoàn toàn ngoại tuyến.

Skill đã được bổ sung hướng dẫn giữ các thẻ HTML cần thiết, dùng `@font-face` cục bộ cho yêu cầu ngoại tuyến và không tự khẳng định đã cách ly mạng khi chưa kiểm chứng. Hướng dẫn này chưa phải cơ chế chặn mạng bắt buộc trong ứng dụng. Các thử nghiệm và giới hạn còn lại phải được kiểm tra trong bản app đóng gói và trên Windows/Linux.
