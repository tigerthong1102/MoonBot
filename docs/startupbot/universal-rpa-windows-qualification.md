# Qualification CUA Windows 0.45.4

## Saved Steps sau khi mở lại ứng dụng

Smoke tương tác dùng CUA 0.45.4 trên Windows x64 và chạy hai tiến trình WinForms nối tiếp trong desktop riêng. Lượt đầu ghi thao tác điều hướng từ phản hồi MCP qua `ComputerJournal`, chạy `buildRecipe` và lưu bằng `RecipeStore`. Lượt sau mở ứng dụng với PID mới, mở lại kho recipe từ đĩa và gọi `runSteps`. Scope thử nghiệm chỉ cho phép một click nền vào nút của fixture. Chỉ tính PASS khi snapshot UIA mới đọc được `After navigation` từ ô trạng thái vốn hiển thị `Before navigation`.

Selector `uiaWindowChild` chỉ dùng cho nút UIA `Button` có nhãn duy nhất trong cửa sổ, đang enabled, ở depth 1, thiếu parent trong projection đầy đủ lược root. Capture và replay kiểm tra cùng bằng chứng. Sau approval, replay tìm lại app, cùng PID và HWND, đọc lại nút và lấy token mới trước click. Recipe chỉ lưu identity. Token cũ, cây thiếu, nút trùng nhãn, depth lớn hơn 1 thiếu cha hoặc delivery khác background accessibility đều không đạt điều kiện cho selector này.

Chạy khối PowerShell ở mục **Tái lập** để kiểm chứng từ đầu. Mỗi lượt dùng thư mục tạm riêng và xóa recipe sau smoke. Đây là kết quả qua các thành phần Saved Steps của server. Gate phát hành Windows, UI chat và nghiệm thu trên ứng dụng nghiệp vụ còn ngoài phạm vi của smoke.

## Kết quả ban đầu ngày 19/11/2026

Máy Windows x64 build 26300, Node 24.13.1, WinForms fixture được biên dịch bằng csc của .NET Framework. Source base `7a17c824767dc01fdf79cc6d0c96a2ade58a5774`. Asset upstream khớp SHA-256 ghim `949927b4cb0519c6fb1377878d67d79a8d6fae7bc56cbed17c7aa26448d82cb5`. Phiên Windows chạy ứng dụng tổng hợp trong desktop Win32 riêng, không cần chuyển màn hình ở lần chạy cuối. [Release upstream](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.45.4)

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| CLI và native MCP | PASS | `cua-driver 0.45.4`, 63 công cụ, hợp đồng 0.8.0 do SDK báo. |
| Host nhúng Windows | PASS | SDK khởi động daemon không console, CLI proxy kết nối và host dọn daemon. Lần chạy sandbox mặc định hết thời gian chờ named pipe. Chạy lại ở phiên Windows có quyền truy cập pipe đã đạt. |
| Fixture WinForms, hai lần khởi chạy | PASS | CUA tìm app/window theo PID, HWND và đúng title, trả UIA role/label/value/enabled và token. Token cũ bị từ chối trước điều hướng. Action trả `route: accessibility`, `delivery.mode: background`. Hậu điều kiện được đọc từ UIA mới ở cả hai vòng. |
| Ghi nhận bằng Saved Steps | BLOCKED | Sau điều hướng đã xác minh, `buildRecipe` từ chối `unknown-target`. Nút có `depth: 1`, thiếu `parent_index`. Dữ liệu gọi `get_window_state` phải chỉ định `tree_format: elements` để có structured rows. |
| Lưu và replay Windows trong StartupBot | BLOCKED | Capture chưa đủ bằng chứng chuỗi cha. Qualification không sinh file recipe và không gắn runtime gate cho Windows. Vòng thứ hai dùng CUA trực tiếp để thử fresh selector sau khi mở lại fixture. |
| Regression Saved Steps | PASS / SKIP | Sau chạy lại ngoài lỗi loopback/Electron trong sandbox, 671 PASS và 1 SKIP ở 20 bộ test. |
| Ma trận Windows, vendor thật | SKIP / BLOCKED | Chưa chạy Win10, ma trận DPI/màn hình/ngôn ngữ, foreground, modal, WPF và custom controls. Chưa có nghiệm thu build vendor hoặc dữ liệu demo. |

Mẫu chạy ghi 18 CUA calls trong 3.551 ms cho hai vòng gồm khám phá, kiểm token và read-back, chưa tính staging. Effect của hai click chỉ được coi đạt sau khi thấy đúng trạng thái UI. Có 0 gọi AI, 0 input/output tokens và 0 lần phê duyệt thủ công trong fixture. Hai thử token cũ là negative tests có chủ đích. Bộ đo ghi thời gian theo từng lệnh MCP. Cần chạy cùng tác vụ với AI thật để có baseline chi phí/tốc độ, nên kết quả đơn lẻ này chưa cho biết mức tiết kiệm.

## Tái lập

Chạy trong checkout thử nghiệm. Host cần quyền thông thường để tạo desktop riêng và named pipe. Launcher không gọi `SwitchDesktop` và fixture xác minh desktop có tên do launcher tạo trước khi hiện cửa sổ.

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm build:cua:win
pnpm exec vitest run scripts/testing/cua-win-qualification.test.mjs
pnpm smoke:cua-win

$root = (Get-Location).Path
$stage = Join-Path $root 'dist-native\cua-win32-x64'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$fixture = Join-Path $stage 'cua-win-navigation-fixture.exe'
$launcher = Join-Path $stage 'cua-win-private-desktop.exe'
$fixtureSource = Join-Path $root 'scripts\testing\cua-win-navigation-fixture.cs'
$launcherSource = Join-Path $root 'scripts\testing\cua-win-private-desktop.cs'

& $csc /nologo /target:winexe /r:System.Windows.Forms.dll /r:System.Drawing.dll "/out:$fixture" $fixtureSource
if ($LASTEXITCODE -ne 0) { throw 'Không biên dịch được fixture' }
& $csc /nologo /target:exe "/out:$launcher" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'Không biên dịch được launcher' }
$entry = Join-Path $root 'scripts\testing\cua-win-interactive-entry.mjs'
$log = Join-Path $stage ('qualification-' + [guid]::NewGuid().ToString('N') + '.log')
& $launcher (Get-Command node).Source $entry $log
$result = $LASTEXITCODE
if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Encoding UTF8 }
if ($result -ne 0) { throw 'Windows qualification không đạt' }
```

Bộ regression chạy riêng.

```powershell
pnpm exec vitest run server/saved-steps server/routes/saved-steps.test.ts server/routes/computer-journal.test.ts server/local-computer-proxy.test.ts server/local-computer.test.ts server/delta-context.test.ts src/components/SavedStepsChip.test.ts src/components/SavedStepsRow.test.ts server/testing/fake-cua-driver.test.ts --no-file-parallelism
```

Thay đổi gồm `scripts/smoke-cua-win-embedded.mjs`, `scripts/cua-win-qualification.mjs`, launcher, fixture, entry, test và tài liệu này. Dùng lại MCP transport, SDK, slim wire, matcher và buildRecipe có sẵn. Tất cả code chạy theo chế độ qualification. Repo không thêm library mới. Toolchain chỉ biên dịch fixture thử nghiệm và không thêm thành phần vào manifest phân phối. Inventory native của bộ cài Windows vẫn cần review riêng.

Trước khi merge harness, chạy smoke hiện có và suite contract trên CI. Trước khi mở Saved Steps Windows, xác minh hoặc thay contract selector đối với projected UIA, test replay sau restart với quyền rõ ràng, loại trừ side effect nghiệp vụ và chạy ma trận Windows còn thiếu. Cần mở lại review nếu thay version driver hoặc thay profile ứng dụng.
