# Đóng gói StartupBot cho khách hàng

## Mac Apple Silicon

Trên Mac arm64 dùng để phát hành, cài Node.js 24 trở lên, pnpm theo package.json và Xcode Command Line Tools. Đăng nhập Apple Developer và cài chứng thư **Developer ID Application** cùng khóa riêng vào Keychain. Dùng notarytool lưu thông tin xác thực vào profile Keychain tên startupbot-notary hoặc đặt STARTUPBOT_NOTARY_PROFILE thành tên profile sẵn có. Apple hướng dẫn thiết lập tại [Developer ID](https://developer.apple.com/developer-id/).

Chạy từ checkout của phiên bản đã duyệt:

```bash
scripts/customer-mac.sh preflight
scripts/customer-mac.sh build
```

Nếu Keychain có nhiều chứng thư hợp lệ, đặt STARTUPBOT_SIGNING_SHA1 thành fingerprint của chứng thư được chọn. Lệnh build dựng app, ký app và DMG, yêu cầu Apple notarize, ghim vé vào DMG, kiểm tra Gatekeeper, cài vào thư mục biệt lập và mở bản đã cài. Kết quả thành công in đường dẫn thư mục customer gồm bộ cài, checksum và hướng dẫn tiếng Việt. Biên nhận Apple, kết quả so payload và chạy thử ở thư mục cha. Việc phát hành cho khách dùng kênh do chủ dự án chọn.

Có thể kiểm lại một DMG đã nhận trên macOS bằng lệnh sau, thay TEAM_ID bằng Team ID của chính nhà phát hành:

```bash
scripts/customer-mac.sh verify /path/to/StartupBot.dmg TEAM_ID
```

## Windows x64

Trên máy ký Windows có chứng thư code signing và khóa riêng trong Windows Certificate Store, chạy PowerShell từ repo. Thay THUMBPRINT bằng 40 ký tự hex của chứng thư đã chọn.

```powershell
.\scripts\customer-windows.ps1 preflight -Thumbprint THUMBPRINT
.\scripts\customer-windows.ps1 build -Thumbprint THUMBPRINT
.\scripts\customer-windows.ps1 verify -Thumbprint THUMBPRINT -Installer C:\path\to\StartupBot-setup.exe
```

Lệnh build kiểm tra chữ ký Authenticode, dấu thời gian và thumbprint trên EXE cài đặt và ứng dụng đã đóng gói. Chuyển EXE sang máy thử Windows x64 sạch có Node.js, checkout cùng commit và dependencies. Chạy lệnh sau trong PowerShell. Lệnh này cài NSIS cho tài khoản thử, kiểm chữ ký của ứng dụng đã cài, mở ứng dụng bằng hồ sơ biệt lập và chỉ xuất thư mục customer khi nghiệm thu thành công.

```powershell
.\scripts\customer-windows.ps1 accept -Thumbprint THUMBPRINT -Installer C:\path\to\StartupBot-setup.exe
```

Bản mới có chữ ký hợp lệ vẫn có thể gặp cảnh báo danh tiếng SmartScreen trên một số máy.
