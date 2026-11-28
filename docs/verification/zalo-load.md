# Đo tải và độ bền của tích hợp Zalo

## So sánh trên cùng dữ liệu

Thử trên macOS arm64 bằng các dòng tổng hợp phân đều vào 20 nhóm. Mỗi bộ điều khiển trình duyệt mở trang trắng trong một phiên tạm, tạo cùng DOM và lấy đủ nội dung, sau đó chạy cùng bộ chuẩn hóa SDK. Đường zca-js tạo trực tiếp đối tượng SDK trong bộ nhớ. So sánh sâu kết quả của từng lượt với bộ đầu vào kỳ vọng. Đo 20 lô sau một lượt làm nóng. Các số là p50 / p95 tính bằng mili giây mỗi lô.

| Đường xử lý | 100 | 1.000 | 5.000 | 10.000 |
|---|---:|---:|---:|---:|
| zca-js constructors | 0.04 / 0.06 | 0.25 / 0.35 | 1.22 / 1.70 | 2.21 / 3.23 |
| StartupBot CDP | 0.61 / 0.71 | 5.01 / 5.23 | 24.04 / 25.19 | 48.45 / 50.12 |
| Playwright | 3.63 / 5.80 | 28.81 / 30.37 | 138.78 / 141.29 | 280.95 / 292.21 |
| bundled Agent Browser CLI | 8.27 / 8.99 | 16.14 / 16.62 | 50.96 / 52.47 | 94.65 / 96.64 |

Các browser driver dùng cùng file Chromium headless trong gói desktop. Thời gian khởi tạo process và trang trắng đo một lần là 1.589 ms qua helper CDP, 165 ms qua Playwright và 544 ms qua CLI đóng gói. Thứ tự chạy cố định, cache hệ điều hành và khối lượng khởi tạo của từng driver khác nhau. Số đo lô gồm thời gian IPC/truyền dữ liệu tương ứng. Đây là thử nghiệm DOM tĩnh. Nó không đo cách Zalo thực hiện phân trang, ảo hóa hoặc xử lý quyền. CLI và Playwright không tự tải browser hoặc đăng nhập tài khoản.

Chạy lại bằng Node ≥26.4 sau khi cài dependencies từ hai lockfile của dự án và lab. Đặt `ZALO_BENCH_CHROME` tới file Chromium của StartupBot, `ZALO_BENCH_AGENT_BROWSER` tới CLI cùng gói và `ZALO_BENCH_PLAYWRIGHT` tới thư mục module Playwright đã cài để kiểm thử. Chạy `node scripts/qualification/zalo-personal/compare-renderers.mjs`. Không dùng URL, credential hoặc profile cá nhân.

## Ghi bền liên tục

Chạy `node scripts/qualification/zalo-personal/soak.mjs --smoke` cho ba vòng, hoặc `--eight-hours` cho 481 vòng cách nhau một phút. Hai tài khoản tổng hợp dùng trùng ID tin tại 20 nhóm mỗi tài khoản. Mỗi vòng ghi 40 dòng mới và phát lại đủ 40 dòng, kiểm đếm độc lập qua SQLite. Bộ thử mở lại kết nối DB sau mỗi 10 vòng dài. Nó ghi số lần mở lại, dữ liệu trùng, chênh số đếm, khoảng trễ do máy tạm dừng, CPU, RSS, độ trễ ghi và dung lượng DB. Thư mục tạm được xóa khi hoàn tất bình thường.

Chế độ smoke ghi nhận độ trễ của runner và chỉ dùng số sự kiện, bản phát lại và lần mở lại để xác nhận tính toàn vẹn. Chế độ tám giờ báo lỗi nếu có khoảng ngắt.

Lượt smoke trên macOS đã ghi và đọc lại 120 tin riêng biệt, nhận diện 120 bản phát lại và mở lại DB hai lần. Chỉ bản ghi cuối có `phase=complete`, đủ 481 vòng và không có khoảng ngắt mới xác nhận đo đủ tám giờ liên tục. Lượt chạy dài không giữ hệ thống khỏi chế độ ngủ. Kết quả không thay thế kiểm thử listener, mất mạng hay giao tin của tài khoản Zalo thật.

## Phạm vi duy trì

Khi thay tag OpenClaw, zca-js hoặc Chromium, ghi lại SHA/tag, phiên bản Node và integrity từ lockfile, kiểm MIT và advisory, rồi chạy lại cả bộ hồi quy ngoại tuyến, benchmark và smoke trên hệ điều hành được hỗ trợ. Khi upstream thay schema hoặc chính sách, đánh giá lại khả năng nhận dữ liệu và giữ đường chưa đạt ở trạng thái tắt. Các phép đo không tạo migration hoặc thêm dependency vào ứng dụng. Rollback phần thử bằng revert PR này.
