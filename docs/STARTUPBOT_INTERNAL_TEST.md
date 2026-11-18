# StartupBot — thử nghiệm nội bộ

Đây là bản thử nghiệm, chưa phải bản phát hành thương mại. Chỉ tải artifact
từ workflow thủ công **package-linux.yml** của repository
`tigerthong1102/MoonBot`. Kiểm tra SHA trong `build-metadata.json` và checksum
trong `SHA256SUMS.txt` trước khi cài. Không có public release hoặc auto-update.

## macOS

Chọn DMG `arm64` cho Apple Silicon; DMG `x64` dành cho Intel. Mở DMG, kéo
**StartupBot.app** vào Applications rồi khởi động. Không thay thế ứng dụng
OpenMausBot. Bản này ký ad-hoc, chưa notarize; Gatekeeper có thể chặn lần đầu.
Sau khi xác minh nguồn tải, dùng **System Settings → Privacy & Security →
Open Anyway** nếu macOS hiển thị lựa chọn đó. Không tắt Gatekeeper toàn hệ thống.

App ID: `ai.startupbot.desktop`. Profile Electron mặc định nằm tại
`~/Library/Application Support/StartupBot`; workspace tại `~/.startupbot`.
Không nhập, đổi tên hoặc tự di chuyển thư mục dữ liệu của OpenMausBot/MausBot.

Smoke trên macOS giữ HOME của process Electron để Keychain vẫn tìm đúng
dịch vụ hệ điều hành; profile Electron, logs, workspace và HOME của server/engine
được cô lập trong thư mục tạm. Không reset Keychain, không sao chép kho mật khẩu
và không fallback sang lưu khóa dạng văn bản.

Computer Use cần người dùng cấp Accessibility và Screen Recording cho
StartupBot trong Privacy & Security. Chỉ cấp sau khi kiểm tra nguồn tải.
Không cấp quyền thì chức năng liên quan phải từ chối, không được bypass.
Microphone/Speech chỉ cần cho các chức năng giọng nói tương ứng.

## Windows

Giải nén artifact và chạy `StartupBot-…-Setup.exe` trên Windows x64.
Bản nội bộ chưa có chứng chỉ Authenticode; SmartScreen có thể báo nhà phát
hành chưa xác minh. Chỉ tiếp tục sau khi đối chiếu nguồn và checksum; không
tắt SmartScreen toàn hệ thống. Installer chạy cho tài khoản hiện tại.

Profile Electron: `%APPDATA%\StartupBot`; workspace mặc định:
`%USERPROFILE%\.startupbot`. App có thể cùng tồn tại với OpenMausBot.

## AI và kết nối điện thoại

Cấu hình provider/API key hoặc model local trong ứng dụng. Engine giả lập
chỉ có trong thư mục smoke tạm của CI, không được cài vào workspace người dùng.
Smoke chat chứng minh luồng ứng dụng/provider trong fixture; không chứng minh
tài khoản model thật, mạng hay billing của người dùng.

Giữ các chức năng OSS, phone pairing, E2E và revocation. Kết nối LAN/Tailscale
cần cấu hình và mạng phù hợp. Không mặc định dùng cloud/relay upstream.
Host phải bật, thức và có mạng để điện thoại điều khiển agent local.

Native APK/iOS chưa được công nhận sẵn sàng từ việc desktop build thành công.
Không dùng ứng dụng mobile upstream như một bản StartupBot. Native source,
dependency/asset rights, signing và pairing trên thiết bị cần nghiệm thu riêng.

## Phạm vi nghiệm thu

Artifact chỉ được upload sau khi smoke đã cài/mở app, nạp preload, xác nhận
OSS, tạo agent và nhận câu trả lời từ fake engine trong profile tạm, giữ dữ
liệu upstream không đổi và từ chối mutation từ process ngoài renderer.
Kết quả Computer Use là trạng thái quyền; thao tác thật trên máy cá nhân,
provider thật và thiết bị mobile thật không được coi là PASS tự động.

License/NOTICE và attribution vẫn có trong gói. Các giới hạn trong
`LICENSE_GAP.md`, `BRANDING_AUDIT.md` và `RELEASE_READINESS.md` vẫn áp dụng;
merge mã nguồn hoặc artifact nội bộ không phải kết luận được phát hành thương mại.

## Branding và nâng cấp dữ liệu

Bản `0.1.161-internal.20261118.4` thay tên sản phẩm trong UI, thông báo,
locale, prompt và companion. Helper mặc định đã được đánh dấu và còn mang tên
nhà máy cũ được đổi sang StartupBot; giữ nguyên ID, lịch sử, model, quyền và
avatar do người dùng chọn. Bot thường và helper đã đặt tên riêng được giữ nguyên.
Không thay chữ trong nội dung hội thoại hoặc hướng dẫn do người dùng viết.

Icon macOS/Windows/PWA và avatar mặc định được tạo từ đúng ảnh chủ sở hữu cung
cấp. Icon native có khoảng đệm và góc ngoài trong suốt; từng ảnh PNG trong
ICNS/ICO được kiểm tra kích thước. Asset mascot chrome cũ không được nhập vào UI.
LICENSE/NOTICE, tên tác giả, các marker đồng bộ và header giao thức tương thích
vẫn giữ nguyên. Đổi branding không phải kết luận đã giải quyết mọi quyền phân
phối thương mại hoặc nghĩa vụ đối với lịch sử repository.

Telemetry không tải hoặc gửi khi thiếu cấu hình riêng của StartupBot.
Không dùng project PostHog của upstream. Feed thông báo và các liên kết trợ giúp
trỏ về fork; offer Boat chưa được chấp thuận được giữ không hoạt động.
Updater và public release vẫn tắt.

Gate đóng gói phải đi qua onboarding thật, mở chat helper và kiểm tra tên/avatar
StartupBot trong renderer, sau đó tạo agent và thử hội thoại bằng engine fixture.
Bằng chứng đó không thay thế kiểm thử model trả phí, Computer Use tương tác thật,
hoặc kiểm thử trên điện thoại vật lý. Kết quả theo SHA nằm trong artifact từng run.

Bản v3 giữ bộ lọc chống giả mạo cho cả nhãn StartupBot và định dạng cũ, đồng thời
giữ lựa chọn ẩn helper khỏi sidebar. Không dùng v2 cho agent xử lý nội dung web
hoặc tệp không tin cậy. Chỉ dùng artifact v3 trở lên khi có smoke PASS khớp phiên bản
và SHA; không lấy kết quả kiểm thử bản trước làm bằng chứng cho bản mới.

Bản v4 tiếp tục nhận lại helper mặc định cũ đã đổi màu mà chưa có marker,
giữ ID, hội thoại, avatar riêng và trạng thái ẩn. Đăng nhập tổ chức mặc định
không hoạt động khi chưa cấu hình dịch vụ; địa chỉ riêng của chủ hệ thống vẫn
có trong Settings. `VITE_STARTUPBOT_ADMIN_ORIGIN` chỉ dành cho build với portal
HTTPS đã được chủ hệ thống chấp thuận, không tạo hay cung cấp dịch vụ Cloud.
Bộ kiểm tra key của relay/extractor giữ nguyên văn bản wire cố định để tương
thích giao thức; các ngoại lệ nội bộ đó không phải tên hiển thị của ứng dụng.
