# Kiểm chứng Zalo Personal nội bộ

**Quyết định ngày 28/11/2026.** GO cho phòng thử nghiệm ngoại tuyến. NO-GO cho kết nối Zalo Personal thật, tài khoản khách hàng và adapter trình duyệt. StartupBot không nạp package này khi khởi động và installer không bao gồm thư mục thử nghiệm.

## Dependency và nguồn

| Thành phần | Bản đã đối chiếu | Quyết định |
|---|---|---|
| OpenClaw và plugin zalouser | v2026.11.10, commit 6ea542fd97e2876aa4c871ccc494ed5419a03c5c, plugin 2026.11.10, Node >=24.16.0 <25 hoặc >=26.1.0 | Học cấu trúc QR, ranh giới sự kiện, CJS lazy loading và phạm vi theo tài khoản. Không port file, Gateway, secret store hay plugin SDK. |
| zca-js | 2.2.0, tag v2.2.0 tại dadfef18bcac53537741855c99f084152da1fad9, Node >=18.0.0 | Tách thành package npm private có lockfile riêng. Bản mới nhất trên GitHub khi kiểm tra là 2.4.0. |
| StartupBot | main 499e9db515bbcf0d6c4f0a916f53e0b71014be77, Node >=24, Electron ^43.5.0 | Dùng Node >=26.4 cho worker ngoại tuyến để kiểm quyền mạng. Chưa kiểm tra trong Electron đóng gói. |

Package và lockfile OpenClaw cùng ghim zca-js 2.2.0. OpenClaw override tough-cookie thành 6.0.2. Nhánh ESM của zca-js 2.2.0 vẫn import default mà tough-cookie 6 không xuất. Phòng thử dùng CommonJS export như upstream. Lock npm ghim 31 dependency, kiểm tra integrity khi chạy npm ci. Cây con trực tiếp trùng lock upstream ở crypto-js 4.2.0, form-data 4.0.6, json-bigint 1.0.0, pako 2.2.0, spark-md5 3.0.2, tough-cookie 6.0.2. Hai bản resolve mới hơn là semver 7.8.6 và ws 8.23.1 (OpenClaw dùng 7.8.5 và 8.22.0). Ngày kiểm tra, npm audit báo 0 advisory đã biết; npm thông báo crypto-js 4.2.0 đã ngừng duy trì.

OpenClaw ghi MIT © 2026 OpenClaw Foundation. zca-js ghi MIT © 2024–2025 RFS-ADRENO, truong9c2208, JustKemForFun. Mã adapter là triển khai mới. Npm cài gói zca-js cùng license của tác giả trong phòng thử. Việc phát hành dịch vụ kết nối tài khoản cá nhân còn thiếu xác nhận quyền sử dụng nền tảng. [Plugin tại SHA](https://github.com/openclaw/openclaw/tree/6ea542fd97e2876aa4c871ccc494ed5419a03c5c/extensions/zalouser) · [Lockfile](https://github.com/openclaw/openclaw/blob/6ea542fd97e2876aa4c871ccc494ed5419a03c5c/pnpm-lock.yaml) · [SDK tại SHA](https://github.com/RFS-ADRENO/zca-js/tree/dadfef18bcac53537741855c99f084152da1fad9) · [Điều khoản Zalo](https://zalo.me/zalo/dieukhoan/)

## Luồng và ranh giới

- Người điều khiển bắt đầu phiên với ID tài khoản dự kiến và tập hội thoại cụ thể. QR chỉ chuyển ảnh PNG trong bộ nhớ. Sự kiện quét, từ chối và hết hạn có trạng thái riêng. Từ chối/hết hạn kết thúc lượt đăng nhập.
- Adapter so sánh getOwnId() trước khi mở listener, rồi kiểm tra loại hội thoại, ID, chiều gửi và cấu trúc từng tin. Chỉ chuyển text có ID và timestamp hợp lệ thành ZaloEvent. Callback không đưa raw event, cookie, tên hiển thị, QR token hay URL ra ngoài.
- Một manager giữ một lease trên mỗi tài khoản. Khi ngắt kết nối, callback cũ mất quyền, scope bị xóa, listener ngừng và các handler được tháo. Socket đóng chuyển sang coverage_unknown. Không có vòng lặp tự reconnect, gửi, trả lời, tự đánh dấu đã đọc, chạy công cụ, fallback trình duyệt hoặc nâng quyền.
- Bộ chạy qualification tạo child với môi trường tối thiểu, thời hạn 20 giây, V8 old-space 96 MiB, output giới hạn 32 KiB. Child chỉ được đọc thư mục phòng thử, cấm mạng, ghi file, subprocess, worker và addon. Đây là giới hạn cho fixture tin cậy, chưa phải sandbox cho mã thù địch hoặc giới hạn tổng RSS/CPU cấp hệ điều hành.
- Lịch sử, sự kiện chỉnh sửa/thu hồi của Zalo, media, keychain thật và giới hạn CPU cấp hệ điều hành chưa được chứng nhận. Thử nghiệm liên tiến trình, inbox và thu hồi quyền nội bộ được mô tả bên dưới. Gián đoạn có thể mất tin. Upstream đã có báo cáo về trùng listener, thiếu lịch sử và trạng thái listener trông còn hoạt động sau khi mất kết nối. [Trùng sự kiện](https://github.com/RFS-ADRENO/zca-js/issues/348) · [Lịch sử nhóm](https://github.com/RFS-ADRENO/zca-js/issues/402) · [Listener báo sai trạng thái](https://github.com/openclaw/openclaw/issues/181111)

## Chạy lại

Từ thư mục gốc, với Node >=26.4.

```sh
cd scripts/qualification/zalo-personal
npm ci --ignore-scripts
npm test
npm run test:integration
npm audit --omit=dev
npm run benchmark
```

PASS trên macOS arm64, Node 26.4.0. Bộ test chạy SDK thật với fetch fixture trong bộ nhớ từ QR generate qua scan đến decline. Các test thành công đăng nhập dùng API/listener mô phỏng và constructor UserMessage/GroupMessage thật. Bộ test kiểm sai account, nhầm group/DM, hướng tin nhắn, scoped text, hai tài khoản cùng ID tin, listener trùng, stop và stale completion. Không dùng token hoặc tài khoản thật.

### Khôi phục, thu hồi và kết quả gửi chưa biết

Chạy test:integration sau khi cài cả dependency gốc của StartupBot và package thử. Hai bài PASS trên macOS arm64.

1. Hai tiến trình Node độc lập tranh cùng tài khoản trong cùng thư mục local 0700. Mỗi tiến trình chỉ được đọc mã lab và đọc/ghi đúng file khóa dẫn xuất từ ID. SQLite giữ BEGIN EXCLUSIVE trên một file trống riêng cho tài khoản; file không chứa bản ghi. Hệ điều hành nhả khóa khi worker bị SIGKILL. Worker thứ hai có thể khôi phục sau khi worker đầu tiên đã chết. Không xóa file khóa khi còn worker. Phạm vi thử là các runner phối hợp cùng thư mục trên một máy, chưa bao gồm nhiều máy, ổ mạng, quyền ACL Windows hoặc keychain thật.
2. Dùng helper readSecureCredentials/writeSecureCredentials thật của desktop với khóa mã hóa giả chỉ ở RAM và secret tổng hợp. Kiểm tra file mã hóa không chứa chuỗi thử ở dạng rõ. Worker khôi phục qua client.login giả, xác minh danh tính và phát một event từ constructor SDK thật qua Node IPC. Host ghi vào createZaloInbox/SQLite thật, đóng và mở lại DB; phát lại cùng event trả duplicate. Rớt kết nối báo coverage_unknown. Bỏ nhóm chặn event ngay trong worker. Thu hồi grant hủy quyền đọc phiên và chặn event trễ tại inbox. Xóa file phiên làm lần khôi phục sau báo authentication_required. Đăng nhập Zalo thành công và phục hồi keychain sau khởi động lại hệ điều hành chưa được thử.
3. Kịch bản K dùng transport tổng hợp ngoài worker, trong DB fixture. Phê duyệt gắn grant, nguồn, tài khoản, loại hội thoại, người nhận, revision, digest nội dung và hạn dùng. Ghi trạng thái unknown trước dispatch. Transport nhận rồi làm mất xác nhận; sau khi mở lại DB, thử lại hoặc xin phê duyệt lại cùng nguồn đều không phát sinh lần chấp nhận thứ hai. Phê duyệt chưa được thực hiện có thể được người dùng cấp lại khi hết hạn hoặc khi sửa bản nháp lên revision mới. Nonce cũ mất hiệu lực trong cùng câu lệnh ghi. Bộ test kiểm thay nội dung, đổi người nhận, quá hạn và thu hồi. Mã này chỉ dùng cho bài kiểm chứng; Personal chưa có chức năng gửi thật hoặc bằng chứng xác nhận giao tin trên nền tảng.

### Benchmark 5.000 tin tổng hợp và 20 nhóm

Chrome 158 đã cài trên máy, profile tạm, CDP qua pipe, trang about:blank. Fixture tạo DOM trong bộ nhớ, không mở trang Zalo. Nhánh SDK tạo message bằng constructor thật rồi chuẩn hóa. Nhánh DOM đọc cùng dữ liệu từ trang qua CDP rồi chạy cùng phép chuẩn hóa. So sánh sâu toàn bộ output với kỳ vọng sau mỗi lô, 1 lượt làm nóng và 20 lượt đo.

| Đường xử lý | p50 ms/lô | p95 ms/lô | CPU process Node, gồm warmup và kiểm tra |
|---|---:|---:|---:|
| zca-js message trong bộ nhớ | 1,20 | 1,83 | 80 ms |
| DOM tĩnh + CDP + chuẩn hóa | 27,43 | 30,46 | 205 ms |

Mở Chrome và tạo trang mất 1.396 ms. Peak RSS process Node cho cả phép đo là 219 MiB, chưa tính cây tiến trình Chrome. Kết quả phụ thuộc máy, không đo mạng, giải mã WebSocket, virtualization, scroll, tài khoản thật, toàn bộ lịch sử hoặc độ trễ end-to-end. Npm dependencies chiếm khoảng 12 MiB trong phòng thử. Không có request model hoặc chi phí token. Chưa đo độ ổn định dài hạn, thời lượng pin, tổng RAM Chrome hoặc kích thước installer đã build.

**Quyết định browser.** Runtime Chrome/CDP có sẵn đọc được DOM mẫu. Chưa thấy cơ sở để thêm Playwright/Chromium vào sản phẩm, hoặc dùng trình duyệt thay thế khi Zalo từ chối truy cập. Chỉ cân nhắc pilot sau khi có quyền và bằng chứng API/DOM thật.

## Nâng cấp và rollback

Giữ cố định zca-js cho tới khi so sánh release, SHA, npm integrity, manifest, export CJS/ESM, lockfile, advisories, privacy và hành vi listener ở bản thay. Chạy lại bộ test, benchmark, packaged smoke và pilot được phép trước khi xét phát hành. Rollback phòng thử bằng revert thay đổi dưới scripts/qualification/zalo-personal cùng tài liệu này. Thử nghiệm không tạo migration, session hoặc dữ liệu người dùng.
