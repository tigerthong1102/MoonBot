# Nền móng kế toán thử nghiệm

Fixture dùng adapter Synthetic Accounting Test 1, với hai công ty demo, danh mục tài khoản và đối tượng cố định, kỳ 11/2026 mở và các kỳ khác khóa. Workflow có version, schema input, pre/postcondition, capability, provenance và quy tắc phục hồi. Quyền bind bot, máy, actor, công ty, capability, phiên bản adapter và digest workflow. Phê duyệt bind thêm định danh và toàn bộ nội dung chứng từ dự kiến. Giá trị tiền được chuyển từ chuỗi sang số nguyên BigInt theo đơn vị nhỏ nhất. VND dùng 0 chữ số thập phân, USD dùng tối đa 2.

Một khóa SHA-256 theo công ty, niên độ, kiểu draft và mã chứng từ được reserve bền trước dispatch. Hai kết nối vào cùng fixture SQLite cùng tuân theo khóa duy nhất. Cơ sở dữ liệu cục bộ chỉ được tạo qua `mkdtemp`. Bảng draft được đọc độc lập với phản hồi giả lập từ thao tác lưu. Sai đối tượng dù số tiền như nhau trả `FAILED`. Mất phản hồi, gián đoạn và thiếu read-back dùng `UNKNOWN` khi chưa xác minh được. Chạy lại với cùng khóa chỉ đọc, và thay đổi dữ liệu cùng khóa bị từ chối. Fixture dựa vào `node:sqlite` có sẵn trong Node 24, không thêm dependency phân phối.

Chạy từ root với Node 24.

```powershell
pnpm exec vitest run scripts/testing/mock-accounting-rpa.test.mjs
```

**PASS trên Windows x64 với Node 24.13.1.** Bảy bài kiểm thử, gồm 10.000 ca với oracle kỳ vọng. Kết quả 6.000 VERIFIED, 2.500 BLOCKED, 1.000 UNKNOWN và 500 FAILED được cố tình đưa vào. Tất cả ca khớp oracle. Có 7.500 lần dispatch và 7.000 bản ghi trong bảng thử, gồm một số bản ghi seed hoặc sai giá trị có chủ đích. Stop và timeout 30 giây chặn cả phê duyệt đến muộn. Hai kết nối đồng thời và mở lại SQLite cùng dữ liệu kiểm tra mỗi khóa chỉ ghi một lần. Không thấy sai lệch bị bỏ qua, ghi trùng sau retry hay UNKNOWN bị báo VERIFIED trong các ca kiểm tra.

Fixture báo 0 lần gọi AI, 0 input/output tokens, 0 lần gọi CUA và 7.500 lần gọi callback phê duyệt mô phỏng. Con số phê duyệt chỉ đo test. Kết quả timing cơ sở dữ liệu cục bộ chưa dùng để so với thao tác UI từng bước của AI.

Phạm vi gồm `scripts/testing/mock-accounting-rpa.mjs` và test đi kèm. Nhật ký bền hiện giữ reservation và digest cùng nguồn draft để xác minh sau reconnect, chưa đóng vai trò audit trail sản phẩm toàn phần. Cần review độ bền qua process crash/mất điện và grant store thực tế trước pilot. Vendor/SQL sản xuất và rollout thương mại **BLOCKED**. Nghiệm thu tiếp theo cần nguồn read-back độc lập, build và dữ liệu demo được phép sử dụng cùng kết quả driver Windows ở phiên bản được duyệt.
