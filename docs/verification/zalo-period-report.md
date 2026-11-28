# Báo cáo Zalo định kỳ trong Today

Pilot cho owner của ứng dụng desktop dùng một bot Official và một chat riêng đã ghép cặp. Tại Settings, mở kết nối Official đang cấp quyền. Trong **Báo cáo Zalo trên máy**, đối chiếu bot, chat và người gửi; chọn giờ, phút, múi giờ IANA và tần suất hằng giờ/hằng ngày. Today hiện tối đa năm kỳ đã đến hạn cùng thời điểm kỳ kế tiếp. Kỳ đầu bắt đầu lúc người dùng lưu lịch. Việc đổi lịch bắt đầu khoảng mới từ thời điểm lưu.

Sau khi commit thay đổi lịch, API đánh thức ngay đồng hồ đến hạn của Routine. Fixture đối chứng lưu lịch đúng một giây trước kỳ đầu: có thông báo thì biên nhận xuất hiện đúng hạn; bỏ thông báo thì chưa có biên nhận cho đến lượt kiểm sau.

Máy chủ phải bật cả `STARTUPBOT_ZALO_OFFICIAL_PILOT`, `STARTUPBOT_ZALO_OFFICIAL_WEBHOOK_PILOT` và `STARTUPBOT_ZALO_LOCAL_REPORTS` cho account pilot đã cấu hình. Mặc định không có báo cáo. GET/POST yêu cầu attestation của desktop owner. Cấu hình dùng revision gắn đúng grant và vòng đời lịch. Dừng và xóa báo cáo làm mất hiệu lực kể cả yêu cầu lưu cũ đến trễ. Hệ thống tái sử dụng đồng hồ đến hạn và lịch cron theo múi giờ của Routine. Lần kiểm tra khi app mở lại xử lý tối đa 12 kỳ mỗi lượt trong phạm vi còn lưu. Không đánh thức máy đang tắt.

Khi kỳ đến hạn, một giao dịch SQLite kiểm lại liên kết endpoint và grant Official đang hoạt động rồi ghi đúng một biên nhận theo grant/thời điểm cuối kỳ. Biên nhận chỉ giữ mốc đầu, cuối và múi giờ. Khi owner xem lại, hệ thống tính số liệu từ sự kiện đến còn được phép trong khoảng nửa mở [đầu, cuối). Việc xóa tin, thu hồi quyền hoặc hết hạn ảnh hưởng ngay tới lần đọc tiếp theo. Chat đang mở làm mới khi có focus và định kỳ 30 giây. Không lưu lại nội dung nguồn hoặc số tổng hợp cũ. Khóa ngoại xóa lịch và biên nhận cùng grant khi thu hồi. Cấp lại quyền tạo grant mới, cần owner chọn lịch lại.

Mỗi kỳ đếm mọi tin đến còn hiệu lực. Quy tắc tiếng Việt chỉ xét tối đa 200 tin đầu kỳ để gắn dấu hiệu khẩn; giao diện ghi số tin thực sự đã xét. Báo cáo luôn nêu phạm vi quan sát và đếm cảnh báo gián đoạn. Không có bằng chứng toàn bộ lịch sử, authoritative business status hay mọi tin bị bỏ sót. Đích duy nhất là màn hình nội bộ trên máy owner; không tạo agent turn, không dùng model, không gửi Zalo/email hoặc lưu raw text vào Routine. Khi đồng hồ đến hạn bị trễ thì báo cáo ghi thời gian kỳ đã lên lịch.

Các bài fixture thực hiện tạo lịch qua HTTP, nhận text tổng hợp vào SQLite, chạy RoutineManager.tick hai lần, đọc report từ cùng API mà Today sử dụng, kiểm gỡ quyền, đổi account, replay sau dừng, giới hạn xét và xóa khoảng thời gian. Kiểm giao diện cho lưu lịch và hiển thị/thu hồi report trong Today. Chạy với Node 24+.

```sh
pnpm exec vitest run server/zalo-period-report.test.ts server/zalo-period-routine.integration.test.ts server/routes/zalo-period-report.test.ts src/components/ZaloPeriodReports.dom.test.ts
```

GO pilot nội bộ theo scope trên. Chưa đo soak dài hạn, tải báo cáo nhiều account, gửi đến đích bên ngoài hoặc lịch sử thật trong nhóm. Rollback bằng tắt cờ local reports. Nếu owner muốn xóa dữ liệu kỳ, chọn dừng và xóa trước khi tắt flag, hoặc thu hồi grant theo quy trình hiện hữu.
