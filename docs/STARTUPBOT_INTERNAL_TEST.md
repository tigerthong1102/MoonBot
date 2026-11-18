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

## Internal desktop v5: promotions and provider consent

v5 disables built-in upstream sponsor cards and Cloud marketing; the owner-controlled announcement engine, schedules, audience rules, required-action priority and per-card seen records are retained. Boat/ModelGo sponsor banners are removed from README. ModelGo provider links have no upstream sponsorship parameters; user-selected providers remain available. See STARTUPBOT_CAMPAIGNS.md for editing campaigns without application code changes.

New ChatGPT authorization requests suggest StartupBot as the agent name. A previously registered external agent may retain its user-selected name: this patch does not silently delete or re-register a working credential.

macOS permission acceptance is separate from application packaging. The installer uses ai.startupbot.desktop, StartupBot bundle names and owned artwork. An existing OpenMausBot permission entry belongs to its existing authorization and must not be renamed or reused by bypassing TCC. Quit the old StartupBot instance, install the new app into Applications, launch that exact application, request Computer Use and grant Screen Recording/Accessibility to StartupBot locally. The packaging smoke checks bundle identity and signature integrity, but granting real macOS privacy permissions on the owner's Mac is NOT RUN while computer observation reports the Mac locked. No TCC database modification or global reset is performed.

v5 qualification is PENDING until its own build and smoke jobs finish. v4's historical evidence is not a PASS for v5.

Local validation for the v5 patch: 190 targeted tests passed across notices, onboarding, key-row analytics, brand policy, ChatGPT authorization and feed handling; 125 additional/repeated focused tests passed for owner campaign retention, provider-link hygiene and internal release boundaries. `pnpm lint`, `pnpm typecheck`, `pnpm build` passed. The existing v4 signed bundle also passes `codesign --verify --strict` and has StartupBot display/name plus ai.startupbot.desktop; this confirms its metadata, not permission-list behavior on the owner's locked desktop. New v5 packaging acceptance remains pending.

## Internal desktop v6: existing output folder continuity

The Codex sync-folder finding is confirmed. Profiles whose recorded output places or bot directory metadata belong to Documents/MausBot retain that existing root; the Files panel and Open folder use it consistently. The chosen root is persisted across restart, output-toggle and sync-state reset. Fresh profiles still use Documents/StartupBot and do not adopt another application's directory merely because it exists. This change moves or deletes no existing user folder. An inherited directory name is retained for data continuity, not used as the application's product identity.

Regression proof: the new isolated fixture fails against the pre-fix runtime. With the patch, the complete cloud-sync Node suite reports 62 PASS, 0 FAIL, 3 filesystem-dependent SKIP (65 total). Fixtures cover saved places, metadata-only ownership, subsequent report replacement with recoverable old-version trash, newly downloaded task output, restart/reset/toggle persistence, fresh-profile separation and preservation of original files. v5 native macOS/Windows packaging run 44251139174 was SUCCESS; v6 requires its own acceptance run after this source change.

## Internal desktop v7: all connection identities

The connection branding audit covers all in-repository OAuth/ACP/MCP identity emitters, not only ChatGPT. New clients advertise startupbot/StartupBot across Codex, ACP, discovery, background text, browser, linked/shared desktop and Composio flows. Agent/phone/connector/permission/headless MCP server descriptions use StartupBot identities. New Composio user IDs have a StartupBot prefix; existing IDs and grants remain intact, including strict ambiguity refusal when several installations share a project. A dedicated AST guard rejects retired product names in connection metadata. Protocol health, tool/mount namespaces, configured user client IDs and required third-party compatibility names are retained.

Local validation: 400 tests passed in the first connection batch; the extended batch passed 455 tests; model-discovery/linked-computer checks passed 64 tests. Lint, typecheck and build passed. These counts overlap and are not a count of unique tests. Actual live provider consent and previously registered external app labels require their owner-controlled provider configuration; see STARTUPBOT_CONNECTION_BRANDING.md. v7 packaging and final-head CI must qualify the new source. The v6 macOS/Windows run 44254565014 was SUCCESS and is historical evidence only.

### Connection metadata package regression

At `34d8ddf1bc90d497611b9365c817245031c811ca`, both internal desktop jobs reached their real browser checks but failed the MCP identity assertion: the server correctly advertised `startupbot-mcp`, while the smoke still expected the retired name. The assertion now requires the StartupBot identity; initialize, API health, final-frame drain, process cleanup, encrypted backup and trust checks remain enforced. Local rebuilt packaged-server smoke PASS. Fresh Windows/macOS package jobs and final-head CI are still required.

### Internal v8 connection and CI follow-up

Internal v7 at `9423a8b2b859e5d78ea9469d650e61b6d9c5f893` passed native macOS ARM64 and Windows x64 installation/launch/package smoke in run 44259286635; Intel DMG remains build-only. Full CI 44259227270 exposed two stale Boat-offer tests in Ubuntu shard 3, not a failed production advertisement gate. The preserved engine tests now explicitly enable their test flag, and a new default-off regression proves StartupBot suppresses the upstream offer while retaining the provider card. All 27 API-key/internal-boundary tests pass locally.

Internal v8 additionally renames new CLI pairing labels, the default Grok tool profile, and extraction/decision key-check text. Explicit user labels and inherited profile names remain unchanged. This fork’s strict relay fixtures and validators are updated together; no upstream cloud access is enabled. Local connection/extractor/decider/branding tests: 360 PASS, 2 conditional SKIP. Lint, typecheck, build and rebuilt packaged-server smoke PASS. Fresh native packages and final-head full CI remain required.

## Lossless size optimization

The measured internal-v4 ARM64 baseline is 321,744,967 bytes as UDZO. Converting that same image to ULMO produces 241,306,247 bytes (25.0% smaller). An isolated read-only mount comparison verifies all 2,887 application files, executable modes and symlink targets unchanged (809,284,773 logical payload bytes); code-signature and image-integrity checks PASS. This is a download-size improvement; the fully bundled Electron, browser, data, CUA and Android tools remain. No language, provider, model capability, image quality or offline component is removed.

Internal v9 uses maximum NSIS compression and verified ULMO conversion after building supported UDZO images. Every installed application is compared byte-for-byte with its packaged source before launch. The native installer/browser/server smokes remain mandatory. ARM64 and Intel DMGs are uploaded separately with scoped checksums and explicit native-smoke versus build-only qualification, avoiding a combined two-architecture download. A new v9 build is required; the baseline numbers are not presented as final v9 results.


Internal v10 additionally disables NSIS differential-archive layout for manual
Windows trial installers. electron-builder 26.15.3 forces differential archives
to a non-solid 1 MiB dictionary, overriding the requested compression mode.
These internal installers instead use full solid compression. Application
payloads, installation and full-installer upgrades remain supported; the base
production updater/differential configuration is unchanged and remains gated.
Windows is rebuilt and payload/installation/browser/server checks rerun for
this packaging change. macOS v9 remains a separate unchanged qualified build;
its source SHA and acceptance are reported independently.
