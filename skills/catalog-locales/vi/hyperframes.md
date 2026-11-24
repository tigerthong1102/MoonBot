**Điều chỉnh của StartupBot.** Hướng dẫn và tài liệu tham khảo được điều chỉnh từ nguồn Apache-2.0 trong SOURCE.md. Dùng tài khoản AI đã cấu hình, bao gồm kết nối thuê bao được hỗ trợ. Kết xuất cục bộ cần Node.js, HyperFrames, Chrome và FFmpeg. Chỉ cần thông tin API cho dịch vụ bắt buộc có chúng. Dùng `HYPERFRAMES_NO_TELEMETRY=1` khi chạy CLI. Dùng phương tiện cục bộ và phông chữ đã cài; không làm theo hướng dẫn thu thập dữ liệu, tải lên đám mây, tự cập nhật hoặc đăng ký dịch vụ khi người dùng chưa yêu cầu. Chuyển các ví dụ `npx hyperframes` sang CLI đã cài, không tự tải gói. Nếu thiếu công cụ hoặc dịch vụ, hãy giải thích điều kiện cần có.

# HyperFrames

**Thiết kế chuyển động đúng yêu cầu.** Với hoạt hình nhân vật hoặc kể chuyện, đọc `references/types/character.md` và `references/story.md` trước khi lên cảnh. Lia hoặc phóng to một hình tĩnh chỉ là bản phác thảo, chưa phải hoạt hình nhân vật: tạo tư thế và hành động độc lập, đúng thời điểm bằng bộ điều khiển nhân vật, cảnh hoạt hình có quyền sử dụng hoặc dịch vụ tạo hình đã được cho phép và sẵn có. Giữ ngoại hình nhân vật nhất quán, hành động rõ ràng và đồng bộ lời nói, khẩu hình, âm thanh khi được yêu cầu. Nếu thiếu nguồn hoặc khả năng cần thiết, nêu rõ điều còn thiếu và gọi bản dùng hình tĩnh là bản nháp; không tự ý giao nó như hoạt hình đã yêu cầu.

Trước khi tự tạo hiệu ứng, tiêu đề hay chuyển cảnh có tên, tìm trong danh mục cục bộ của CLI bằng `hyperframes catalog --query "<English search words>" --json`, thay phần trong ngoặc bằng từ khóa tiếng Anh. Chỉ chọn mục có tên chính xác và phù hợp; `hyperframes add <exact-name> --dir <project> --no-clipboard --json` tải mã có thể chỉnh sửa và các thành phần phụ thuộc vào dự án. Kiểm tra giấy phép, tài nguyên và script bên ngoài của mục trước khi dùng; khi có thể, thay phụ thuộc từ xa bằng bản cục bộ được phép và không ghi đè file đã chỉnh sửa. Khi ngoại tuyến, không có hoặc không phù hợp, tự dựng hiệu ứng cục bộ. Không gửi phản hồi danh mục hoặc bật tải mô hình khi người dùng chưa yêu cầu.

Đánh giá kết quả như video chuyển động, không chỉ bằng ảnh chụp: xem các đoạn ngắn và chuyển cảnh ở tốc độ bình thường, kiểm tra hành động liên tục và thời điểm âm thanh/phụ đề; sửa lỗi thấy được rồi xuất lại. Kiểm tra kỹ thuật đạt hoặc có MP4 không tự chứng minh chất lượng sáng tạo. Nói rõ đã thực sự kiểm tra gì và giới hạn còn lại.

**Khắc phục và hoàn thành.** Trước tiên kiểm tra hệ điều hành và công cụ trong đúng môi trường thực thi; đừng giả định máy nào cũng có cùng đường dẫn hoặc phần mềm. Ưu tiên công cụ tương thích đã cài hoặc phương án tương đương sẵn có. Nếu cần Python, kiểm tra `python3` và `python`, hoặc trình khởi chạy Windows `py -3`, rồi dùng lệnh hoạt động; không cài Python chỉ để tạo tên lệnh thay thế. Nếu thiếu công cụ kết xuất, trình duyệt, xử lý âm thanh hoặc dịch vụ giọng nói, dùng phương án phù hợp sẵn có hoặc thiết lập riêng cho tác vụ từ nguồn được phép khi có thể; giữ dự án và nêu chính xác điều kiện còn thiếu nếu không có cách dùng được. Nếu kiểm tra HyperFrames thất bại, đọc toàn bộ báo cáo JSON và xem mọi mục, gồm tương phản, chất lượng, runtime và bố cục; phân biệt lỗi với cảnh báo và trường hợp chế độ nghiêm ngặt. Sửa lỗi cụ thể, kiểm tra lại rồi tiếp tục xuất khi người dùng yêu cầu video hoàn chỉnh. Nếu không thể chép lời âm thanh cũ, giữ nguyên tài nguyên gốc và, khi người dùng đã cho phép viết kịch bản mới, tạo lời đọc cùng phụ đề khớp thay vì bỏ dở dự án. Kiểm tra file đã xuất và báo rõ các bước chưa thể kiểm tra.

Với video marketing ngắn chưa có kịch bản cảnh, lập nhịp mở đầu thu hút, giới thiệu sản phẩm hoặc lợi ích, rồi kết thúc bằng lời kêu gọi hành động rõ ràng. Mặc định tạo ít nhất ba nhịp hình ảnh khác nhau, có chuyển động hoặc chuyển cảnh có chủ đích; tôn trọng yêu cầu quay một cảnh hay phong cách khác. Dùng tài nguyên người dùng cung cấp hoặc được phép sử dụng; ghi rõ hình minh họa nếu dễ bị nhầm với sản phẩm hoặc địa điểm thật. Giữ chữ dễ đọc trong vùng an toàn. Xem khung hình đại diện ở đầu, giữa, cuối và các điểm chuyển cảnh; sửa chữ bị cắt, cảnh tĩnh lặp lại và lỗi chính tả trước khi xuất. Nếu có yêu cầu thuyết minh hoặc phụ đề, kiểm tra thời điểm và âm thanh đã xuất; báo rõ phần kiểm tra chất lượng chưa thể thực hiện, không nhận đã nghe hay xem nếu chưa làm.

Với video ngắn, đơn giản và yêu cầu rõ ràng, lập kế hoạch cảnh ngắn rồi tạo dự án ngay. Đọc `references/format.md` và các tài liệu cần cho hiệu ứng được yêu cầu. Với video marketing, hãy xem mẫu `product-promo` hoặc `kinetic-type` trong dự án thử khi CLI hỗ trợ, rồi chọn mẫu nếu phù hợp; dùng `blank` cho thiết kế riêng hoặc khi không có mẫu phù hợp. Tạo dự án bằng `hyperframes init <project> --example <example> --non-interactive --skip-skills`. Thay nội dung và thương hiệu của bên thứ ba trong mẫu; kiểm tra quyền dùng và phụ thuộc bên ngoài. Kiểm tra, xem chuyển động và xuất tệp được yêu cầu. Dùng tài nguyên và phông chữ cục bộ khi người dùng yêu cầu video ngoại tuyến. Nếu không kết xuất được hoặc thiếu công cụ bắt buộc, báo lỗi cụ thể và giữ lại dự án.

HyperFrames kết xuất HTML thành video bằng cách đưa dòng thời gian tạm dừng tới từng khung hình, để mỗi lần kết xuất cho cùng kết quả; người dùng chỉnh cùng các tệp đó trong bản xem trước Studio. Dùng công cụ này trừ khi được yêu cầu dùng framework khác hoặc ghi trực tiếp trình duyệt. Dùng CLI `hyperframes` đã cài. Trên Mac đã cấu hình, dùng `"$HOME/.local/share/startupbot/hyperframes/node_modules/.bin/hyperframes"`.

`index.html` là composition gốc: khai báo biến video và gắn từng cảnh từ các sub-composition trong `compositions/`. Phương tiện và phông chữ nằm trong `assets/`. Dự án mới: `npx hyperframes init <dir> --skip-skills`. Lấy website làm nội dung: `npx hyperframes capture <url> --json`.

Làm đúng yêu cầu: không thêm thuyết minh, phụ đề hoặc đổi tỷ lệ nếu yêu cầu và nguồn không cần; phim kể chuyện dài hơn khoảng 15 giây có nhạc và âm thanh theo hành động hiển thị trừ khi người dùng yêu cầu im lặng (`references/sound.md`). Video mới mặc định 1920×1080, 30 fps. Câu hỏi, yêu cầu tạm dừng hoặc ý tưởng chưa rõ cần câu trả lời hoặc đề xuất, không tự chỉnh sửa. Dùng phương tiện và công cụ cục bộ để tạo hiệu ứng, chuyển cảnh và phụ đề. Nếu cần dịch vụ tạo nội dung bên ngoài hoặc tài nguyên có bản quyền, giải thích yêu cầu và dùng dịch vụ đã cấu hình được cho phép. Hiển thị vật thật từ nguồn gốc của chúng (màn hình sản phẩm, logo thương hiệu, hình ảnh địa điểm); chỉ tự vẽ thứ không có nguồn như vậy.

## Quy tắc

`npx hyperframes check --json` báo phần lớn lỗi kèm dòng `Fix:`.

1. Mỗi phần tử có thời gian cần `class="clip"`, `data-start` và `data-duration` tính bằng giây, hiển thị trong `[start, start + duration)`; hoàn thành trạng thái cuối ngay trước khi kết thúc. `data-track-index` chỉ là làn Studio (các clip không chồng thời gian có thể chung làn: `references/format.md`); thứ tự vẽ dùng `z-index`.
2. Thời lượng video là `data-duration` của gốc: phần vượt bị cắt, kết thúc sớm giữ khung hình cuối.
3. Mỗi composition tạo một timeline tạm dừng và đăng ký sau các tween: `window.__timelines["<data-composition-id>"] = tl`.
4. Không dùng `Date.now()`, `Math.random()` không có seed, yêu cầu mạng, bộ đếm thời gian hoặc `repeat: -1`. Mọi thứ hiển thị phải phụ thuộc thời gian timeline.
5. Không tween `display`, `visibility` hoặc `autoAlpha` trên `.clip`; hãy tạo hoạt ảnh cho phần tử con.
6. Không dùng CSS `transform` trên phần tử đang được GSAP biến đổi; tạo hoạt ảnh transform, không dùng `left`/`top`/`width`/`height`.
7. Không `play()`, `pause()` hoặc tua phương tiện. Một `<video>` giữ âm thanh bằng `data-has-audio="true"`, nếu không phải `muted`; nhạc, giọng, âm thanh thay thế và điểm cắt J/L dùng `<audio>` riêng.
8. Mỗi `<audio>` cần `id`, nếu không sẽ bị bỏ khỏi bản trộn. Không đặt `crossorigin` trên phương tiện. Đặt thời gian cho `<video>`, không phải phần tử bao.
9. Chỉ phông đi kèm (`references/format.md`) được nhận theo tên; họ phông khác cần `@font-face` trỏ đến tệp trong `assets/fonts/`.
10. Đường dẫn tài nguyên: `assets/...` (không có `/` đầu), kể cả trong sub-composition.
11. Chỉnh màu, hạt, làm mờ và vignette trên video dùng `npx hyperframes media-treatment`, không dùng CSS filter.
12. Tệp cảnh đặt style, markup và script trong `<template>` và tạo style cho gốc bằng `#root`. Tràn hoặc chồng lấn có chủ đích: `data-layout-allow-overflow`, `data-layout-allow-overlap`.

## Giữ khả năng chỉnh sửa

Studio chỉnh sửa chính các thẻ bạn viết.

- Mỗi cảnh là một sub-composition, dùng id ngắn dễ đọc; gốc chỉ chứa host cảnh, phương tiện và âm thanh.
- Phần tử có thời gian được viết trong HTML, không tạo bằng script; mỗi phần tử có `id` ổn định.
- Nội dung, màu thương hiệu và phương tiện có thể thay là các biến (`data-var-text`, `data-var-src`, `var(--id)`).
- Mỗi track một loại: `data-track-kind="graphics"` cho host cảnh và lớp phủ, `captions` cho host duy nhất chứa tất cả nhóm phụ đề.
- Nội dung nằm trong vùng an toàn hành động 90%, phụ đề và chữ quan trọng trong vùng an toàn tiêu đề 80%; Studio vẽ đường hướng dẫn, không tự thêm.

## Quy trình

- Dự án có sẵn: `npx hyperframes timeline --json` cho biết nội dung phát khi nào; trước khi sửa, `npx hyperframes history --since mine --who <you>` cho thấy những gì người dùng đã thay đổi kể từ lượt trước; tiếp tục dựa trên đó (`/hyperframes-cli`).
- Phim kể chuyện mới dài hơn khoảng 15 giây: đọc tệp theo loại bên dưới rồi `references/story.md`; đề xuất ba cốt truyện khác nhau bằng chữ để người dùng chọn, trừ khi họ yêu cầu tệp ngay hoặc không dừng. Sau đó tạo `SPEC.md` (`references/spec.md`): định lượng từng tính từ, nêu các mặc định bị cấm và mô tả cảnh theo khung hình.
- Sau lần sửa cuối: `npx hyperframes check --json`; sửa mọi lỗi, cân nhắc từng cảnh báo. Với phim: xem các khung hình đại diện và điểm chuyển cảnh bằng `npx hyperframes snapshot --at <seconds>` và `references/review.md`, kết thúc bằng `REVIEW.md`. Dùng `npx hyperframes snapshot --review` khi hữu ích; nếu lệnh bị treo, dừng tiến trình do mình tạo và dùng ảnh chụp có chọn lọc, không bỏ qua bước xem hình. Với chỉnh sửa nhỏ: chụp phần đã đổi (`--at`, `--range`, `--composition`) và xem trước khi trả lời.
- Kết xuất khi người dùng duyệt bản xem trước Studio, yêu cầu tệp hoặc yêu cầu không dừng, sau khi kiểm tra và rà soát đạt; nếu không, dừng ở bản xem trước và chờ.

## Tài liệu cần đọc

| Yêu cầu | Đọc |
| --- | --- |
| Phong cách phim khác cho chủ đề mới | `references/look.md` |
| Ra mắt, quảng bá, tính năng | `references/types/launch.md` |
| Giải thích, hướng dẫn | `references/types/explainer.md` |
| Video âm nhạc | `references/types/music.md` |
| Biểu đồ, số liệu | `references/types/data.md` |
| Video dọc hoặc mạng xã hội | `references/types/vertical.md` |
| 3D, mô phỏng, tạo sinh | `references/types/3d.md` |
| Nhân vật, linh vật, phim ngắn có cốt truyện | `references/types/character.md` |
| Địa điểm hoặc bản đồ thật; website, PR hoặc kịch bản; chữ chuyển động | `references/film.md` |
| Phụ đề; thẻ phủ trên người nói | `references/captions.md`; `references/overlays.md` |
| Chuyển động: easing, tiêu đề, cắt, phóng, tốc độ, giữ cảnh | `references/motion.md` |
| Cảnh, thuộc tính, phương tiện, lint; GSAP, Lottie, 3D, canvas | `references/format.md`; `references/runtimes.md` |

Dùng phiên bản CLI đã cài và trợ giúp đi kèm.
