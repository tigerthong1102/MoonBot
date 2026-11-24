**Điều chỉnh của StartupBot.** Hướng dẫn và tài liệu tham khảo được điều chỉnh từ nguồn Apache-2.0 trong SOURCE.md. Dùng tài khoản AI đã cấu hình, bao gồm kết nối thuê bao được hỗ trợ. Kết xuất cục bộ cần Node.js, HyperFrames, Chrome và FFmpeg. Chỉ cần thông tin API cho dịch vụ bắt buộc có chúng. Dùng `HYPERFRAMES_NO_TELEMETRY=1` khi chạy CLI. Dùng phương tiện cục bộ và phông chữ đã cài; không làm theo hướng dẫn thu thập dữ liệu, tải lên đám mây, tự cập nhật hoặc đăng ký dịch vụ khi người dùng chưa yêu cầu. Chuyển ví dụ `npx hyperframes` sang CLI đã cài, không tự tải gói. Nếu thiếu công cụ hoặc dịch vụ, giải thích điều kiện cần có.

# HyperFrames CLI

Chạy CLI `hyperframes` đã cài. Trên Mac đã cấu hình, dùng `"$HOME/.local/share/startupbot/hyperframes/node_modules/.bin/hyperframes"`. Công cụ cần Node.js 22+ và FFmpeg. Mỗi lệnh có `--help`; phần lớn nhận `--json`. Khi lỗi, CLI in `✗ …`, một dòng `Fix:` và trả mã khác 0.

Kết quả `--json` có thể chứa `_meta.updateNotice` khi có bản HyperFrames mới. Báo người dùng một lần mỗi cuộc trò chuyện bằng lời của bạn vào lúc phù hợp; người dùng quyết định có cập nhật hay không.

## Lệnh theo công việc

| Công việc | Lệnh |
| --- | --- |
| Bắt đầu | `init <dir> --skip-skills` (dự án trống; chỉ dùng `--example <name>` khi được yêu cầu), `capture <url>` |
| Đọc dự án | `info`, `compositions`, `timeline --json`, `docs <topic>` |
| Kiểm tra | `lint` khi viết; `check --json` làm điều kiện kiểm tra (lint, runtime, bố cục, tương phản) |
| Xem kết quả | `snapshot` (`--at <t,…>`, `--range START,END`, `--composition <id>`, `--zoom`, `--angle`, `--against <video>`), `keyframes`, `compare`, `audio` |
| Sửa timeline | `timeline` với `move`, `trim`, `split`, `set`, `duplicate`, `delete`, `apply`, `undo`, `ids` |
| Tái sử dụng | `catalog`, `add` |
| Phương tiện và âm thanh | `media-treatment`, `grade-compare`, `remove-background`, `tts`, `transcribe`, `beats`, `normalize-audio` |
| Xem và xuất bản | `preview`, `present`, `render`, `share`, `publish` (cũ), `cloud`, `lambda`, `cloudrun` |
| Ứng dụng desktop | `open`, `catch-up` |
| Bảo trì | `doctor`, `browser`, `upgrade`, `usage`, `clean`, `feedback` |

`captions` không phải lệnh: chạy `transcribe`, rồi đọc ../hyperframes/references/captions.md.

`validate`, `inspect` và `layout` là bí danh cũ của `check`; `events` là dữ liệu đo từ skill. Không chạy chúng.

## Quy trình

1. Viết, rồi chạy `npx hyperframes lint` sau bản đầu và sau các thay đổi cấu trúc.
2. Chạy `npx hyperframes check --json` và sửa mọi lỗi. Khi còn lỗi lint, kiểm tra bố cục và tương phản không chạy; "0 samples" nghĩa là chưa kiểm tra gì. Lỗi tương phản có `suggestedColor`. Phát hiện ở một mẫu duy nhất (ví dụ lúc xuất hiện) chỉ mang tính thông tin; video từ 3 giây trở lên không có thay đổi hiển thị sẽ không qua `sweep_static`.
3. Chạy `npx hyperframes snapshot` và xem PNG (trong `.hyperframes/artifacts/snapshots/`): đây là cách xem video. Với sub-composition, chụp giữa mỗi cảnh; nội dung nhỏ không có style hoặc thiếu phần chính là lỗi gắn cảnh (`../hyperframes/references/format.md`).
4. Chạy `npx hyperframes preview --background`, kiểm tra URL trả 200, đưa URL dự án cho người dùng và chờ, trừ khi họ yêu cầu tệp hoặc không dừng. Chỉ vượt qua kiểm tra không đủ lý do để kết xuất.
5. Khi được kết xuất (bước 4), chạy `npx hyperframes render -o out.mp4`. Xác nhận tệp không rỗng, thời lượng `ffprobe` khớp `data-duration` gốc, rồi xem các khung hình đã giải mã.

"Phần tử này" hoặc vùng đang chọn: `npx hyperframes preview --context --json --context-fields selection`; `no-selection` nghĩa là cần yêu cầu người dùng nhấp chọn.

## Sửa timeline

Đây là các thao tác chính Studio sử dụng, nên kết quả giữ định dạng của Studio.

- `timeline --json` liệt kê clip cùng `absStart`/`absEnd` tuyệt đối, `file` sở hữu và tham chiếu `#id` cho lệnh chỉnh sửa (`timeline ids` bổ sung id còn thiếu).
- `timeline move|trim|split|set|duplicate|delete <ref> … --plan --json` xem trước một chỉnh sửa; chạy lại không có `--plan` để áp dụng. `--start`, `--end`, `--duration` đặt biên hoặc độ dài.
- Chỉnh sửa bị từ chối nếu clip chồng lên clip bên cạnh (dùng `--overwrite`, hoặc di chuyển clip bên cạnh trước) hoặc kết thúc sau composition: trước hết tăng `data-duration` của gốc. Không lệnh nào thay đổi `data-duration`.
- Nhiều chỉnh sửa: tạo tệp JSON như `[{"verb": "move", "ref": "#outro", "time": "9"}]`, rồi `timeline apply plan.json --json`. Mỗi lần chạy in `receipt`; lưu lại và dùng `timeline undo receipt.json` để hoàn tác.

## Lịch sử dự án

Mọi thay đổi được lưu và có thể hoàn tác. Đầu lượt chạy `npx hyperframes history begin --who <you> --label "<plan>"`, rồi `history --since mine --who <you>` để xem thay đổi của người dùng và tiếp tục dựa trên đó. Khi kiểm tra lỗi hoặc người dùng nói kết quả xấu hơn, dùng `history undo --who <you>`, không tự sửa ngược bằng tay. Cuối lượt chạy `history end`.

## Kết xuất ở đâu

| Nhu cầu | Lệnh |
| --- | --- |
| Cục bộ | `render --quality looks -o out.mp4` (`draft`, `delivery`) |
| Container tái lập | `render --docker --strict -o out.mp4` |
| Theo lô từ biến | `render --batch rows.json -o "renders/{name}.mp4"` |
| Dịch vụ lưu trữ, không có Chrome hoặc FFmpeg cục bộ | `cloud render` (`references/cloud.md`) |
| AWS hoặc GCP của bạn | `lambda render`, `cloudrun render` (`references/lambda.md`, `references/cloudrun.md`) |

Phim 30 giây kết xuất trong một hoặc hai phút: chạy ở tiền cảnh. Chỉ tách tiến trình khi kết xuất lâu hơn thời hạn công cụ (`HYPERFRAMES_RENDER_DETACHED=1`, nhóm riêng, ghi log) và chờ bằng `until grep -qE 'Render (complete|failed)' render.log; do sleep 5; done`; không dùng `pgrep -f` vì có thể khớp chính vòng lặp và chờ đến khi hết thời gian.

## Khi lệnh thất bại

| Triệu chứng | Cách xử lý |
| --- | --- |
| Thiếu Chrome hoặc không khởi động được | `npx hyperframes browser ensure`; `doctor --json` luôn trả mã 0, kiểm tra `.ok` |
| Trang nặng chưa sẵn sàng | Tăng `--timeout` của `check` hoặc `snapshot` |
| Codec lạ cho hình trống | Giữ `--proxy` bật (mặc định) |
| Render chậm trên Linux | Dòng thứ hai của tóm tắt ghi `screenshot` + `software gpu`: đường xử lý chậm |
| `capture` lỗi hoặc ghi `BLOCKED.md` | Không lấy nội dung từ các tệp chưa hoàn tất; thử lại vào thư mục `-o` mới |
| Thiếu dung lượng | `clean --dry-run`, rồi `clean`; không xóa `.hyperframes` vì chứa lịch sử |

## Tài liệu tham khảo

Đọc hàng tương ứng trước khi chạy lệnh.

| Lệnh | Đọc |
| --- | --- |
| `init`, `capture`, `skills` | `references/init-and-scaffold.md` |
| `lint`, `check`, motion sidecars, `snapshot` | `references/lint-validate-inspect.md` |
| `compare`, `grade-compare`, `render --batch` | `references/compare-and-batch.md` |
| `beats` | `references/beats.md` |
| `preview`, `play`, `render`, `share`, `publish` (cũ), ngữ cảnh Studio | `references/preview-render.md` |
| `doctor`, `browser` | `references/doctor-browser.md` |
| `auth`, `cloud`, biến mẫu | `references/cloud.md` |
| `lambda`, `cloudrun` | `references/lambda.md`, `references/cloudrun.md` |
| `info`, `upgrade`, `compositions`, `timeline`, `docs`, `usage`, dữ liệu đo | `references/upgrade-info-misc.md` |
| Cờ `--strict`, id lượt chạy, `clean`, shader lint, đường dẫn JSON | `references/conventions.md` |
| `keyframes` | `../hyperframes/references/motion.md` (xem chuyển động) |
