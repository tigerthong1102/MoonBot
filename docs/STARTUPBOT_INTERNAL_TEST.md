# StartupBot — thử nghiệm nội bộ

Đây là bản thử nghiệm, chưa phải bản phát hành thương mại. Chỉ tải artifact
từ workflow **Internal package verification** của repository
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
