**Điều chỉnh của StartupBot.** Hướng dẫn và tài liệu tham khảo được điều chỉnh từ nguồn Apache-2.0 trong SOURCE.md. Dùng tài khoản AI đã cấu hình, bao gồm kết nối thuê bao được hỗ trợ. Kết xuất cục bộ cần Node.js, HyperFrames, Chrome và FFmpeg. Chỉ cần thông tin API cho dịch vụ bắt buộc có chúng. Dùng `HYPERFRAMES_NO_TELEMETRY=1` khi chạy CLI. Dùng phương tiện cục bộ hoặc trực tuyến được phép và phông chữ đã cài; tôn trọng yêu cầu ngoại tuyến và không làm theo hướng dẫn thu thập dữ liệu, tải lên đám mây, tự cập nhật hoặc đăng ký dịch vụ khi người dùng chưa yêu cầu. Chuyển các ví dụ `npx hyperframes` sang CLI đã cài, không tự tải gói. Nếu thiếu công cụ hoặc dịch vụ, hãy giải thích điều kiện cần có.

**Phông chữ ngoại tuyến.** Khi người dùng yêu cầu làm việc ngoại tuyến, chỉ gọi tên phông đã cài là chưa đủ: HyperFrames có thể tự tải phông thay thế khi chạy `check`, `snapshot` hoặc kết xuất. Dùng tệp phông đã có và được phép sử dụng, sao chép vào dự án và khai báo từng họ phông bằng URL `@font-face` cục bộ; dùng họ phông dự phòng chung. Tránh URL phông và phương tiện từ xa. Nếu môi trường hỗ trợ, chặn kết nối ra ngoài cho toàn bộ tiến trình kết xuất và kiểm tra lại; nếu không xác minh được thì phải nói rõ, không khẳng định đã ngoại tuyến. Không đóng gói phông hệ thống để phân phối khi chưa được phép.

**Cấu trúc HTML.** Giữ đầy đủ `<!doctype html>`, thẻ `<html>`, `<head>`, `<body>` và các thẻ đóng khi viết bố cục gốc. HyperFrames CLI 0.9.88 có thể không khởi tạo được trình phát nếu tệp nguồn thiếu các thẻ này dù trình duyệt tự sửa HTML; thấy timeline GSAP không có nghĩa trình phát HyperFrames đã khởi tạo. Nếu `check` hoặc `snapshot` báo chưa thiết lập `window.__player`, kiểm tra cấu trúc tệp, sửa và chạy lại CLI thật trước khi cân nhắc trình kết xuất khác.

**Độ phân giải đầu ra.** Với video marketing dọc mới, dùng bố cục 1080 × 1920 trừ khi người dùng yêu cầu cỡ khác hoặc máy không đủ khả năng. Với dự án có sẵn, xem `hyperframes render --help` trước khi chọn độ phân giải. HyperFrames CLI 0.9.88 từ chối hệ số phóng không nguyên: bố cục 720 × 1280 không xuất trực tiếp được 1080 × 1920. Nếu công cụ hỗ trợ và tài nguyên cho phép, xuất với `--resolution portrait-1440p`, rồi thu xuống 1080 × 1920 bằng `ffmpeg`; kiểm tra kích thước và nói rõ tệp cuối đã được thay đổi kích thước. Nếu không, nêu giới hạn và hỏi độ phân giải phù hợp.

**Giới hạn vòng sửa cảnh báo.** Sửa lỗi và khiếm khuyết nhìn thấy được, đồng thời xem xét cảnh báo. Nếu cảnh báo không ngăn xuất vẫn còn sau hai lần sửa tập trung và có thể kết xuất theo yêu cầu, ngừng liên tục làm lại cấu trúc chỉ vì cảnh báo đó. Xuất, kiểm tra kết quả, rồi báo rõ cảnh báo còn lại và ảnh hưởng; không nói đã sửa xong. Không bỏ qua cảnh báo cho thấy lỗi hình ảnh thực tế, thiếu nội dung yêu cầu, hành vi không an toàn hoặc đầu ra không dùng được.

**Báo đúng trình kết xuất.** Nếu `check`, `snapshot` hoặc render của HyperFrames thất bại và một trình kết xuất khác tạo tệp, hãy nói rõ trình nào đã tạo tệp và những bước kiểm tra HyperFrames nào thất bại hoặc bị bỏ qua. Không mô tả tệp dự phòng là bản render HyperFrames thành công. Không nói đã nghe âm thanh hoặc kiểm tra đồng bộ phụ đề nếu chưa thực sự làm.

Với video marketing, đọc `references/look.md` và chọn hướng hình ảnh phù hợp với yêu cầu trước khi dựng cảnh; có thể dùng tài liệu thiết kế mẫu đi kèm, hoặc thương hiệu và hình tham khảo do người dùng cung cấp. Lên bố cục, điểm nhấn và chuyển động giữa các cảnh; kiểm tra xem hình có lặp lại và sơ sài như mẫu tạm không. Ưu tiên ảnh, cảnh quay, minh họa hoặc tài nguyên chuyển động phù hợp và được phép khi có; nếu thiếu thì nói rõ giới hạn chất lượng.

**Quy trình media.** Khi tìm, tạo hoặc chuẩn bị video, âm thanh và hình ảnh, hãy đọc `../media-use/SKILL.md` đi kèm nếu có và dùng các tài liệu phù hợp. Thuê bao ChatGPT hoặc Grok không tự bảo đảm quyền sử dụng dịch vụ tạo video. Dùng cảnh quay chuyển động thực sự cho cảnh điện ảnh; báo rõ khả năng còn thiếu và xin phép trước khi tải dữ liệu lên hoặc phát sinh chi phí.

**Tư liệu hình ảnh theo yêu cầu.** Trước tiên kiểm tra tư liệu người dùng cung cấp hoặc đã có quyền sử dụng. Nếu video cần hình ảnh chân thực hoặc cao cấp và được phép truy cập mạng, hãy tìm ảnh hoặc cảnh quay có thể tái sử dụng bằng công cụ tìm kiếm sẵn có hoặc trang nguồn công khai trước khi dùng hình vẽ cơ bản. Kiểm tra điều kiện dùng thương mại, ghi công, hạn chế và nguồn gốc từng tư liệu tại trang nguồn; lưu thông tin trong tệp ghi công và chỉ dùng tư liệu có quyền rõ ràng. Không gửi dữ liệu riêng tư ra ngoài khi chưa được phép; không tự đăng ký tài khoản, chi tiền hoặc dùng API trả phí. Tải tài nguyên được phép vào dự án và kết xuất cục bộ. Nếu không có tư liệu phù hợp hoặc dịch vụ tạo ảnh đã cấu hình, nói rõ giới hạn; không trình bày hình minh họa đơn giản như cảnh quay chân thực hay hoạt hình nhân vật.

Với lời đọc, kiểm tra tiếng nói được tạo so với kịch bản và thời điểm phụ đề. Khi đã có công cụ nhận dạng giọng nói cục bộ phù hợp, dùng thêm để kiểm tra và xem xét những chỗ khác biệt đáng kể; công cụ có thể nhận sai nên không thay thế việc nghe. Nếu chưa chắc từ ngữ hoặc phát âm, thử giọng khác sẵn có hoặc thu lại câu bị ảnh hưởng rồi kiểm tra lại. Không tự tải mô hình hoặc dùng dịch vụ giọng nói trả phí khi chưa được phép. Nếu chưa ai nghe trực tiếp, nói rõ và không khẳng định đã xác minh phát âm.

# HyperFrames

**Thiết kế chuyển động đúng yêu cầu.** Với hoạt hình nhân vật hoặc kể chuyện, đọc `references/types/character.md` và `references/story.md` trước khi lên cảnh. Lia hoặc phóng to một hình tĩnh chỉ là bản phác thảo, chưa phải hoạt hình nhân vật: tạo tư thế và hành động độc lập, đúng thời điểm bằng bộ điều khiển nhân vật, cảnh hoạt hình có quyền sử dụng hoặc dịch vụ tạo hình đã được cho phép và sẵn có. Giữ ngoại hình nhân vật nhất quán, hành động rõ ràng và đồng bộ lời nói, khẩu hình, âm thanh khi được yêu cầu. Nếu thiếu nguồn hoặc khả năng cần thiết, nêu rõ điều còn thiếu và gọi bản dùng hình tĩnh là bản nháp; không tự ý giao nó như hoạt hình đã yêu cầu.

Trước khi tự tạo hiệu ứng, tiêu đề hay chuyển cảnh có tên, tìm trong danh mục cục bộ của CLI bằng `hyperframes catalog --query "<English search words>" --json`, thay phần trong ngoặc bằng từ khóa tiếng Anh. Chỉ chọn mục có tên chính xác và phù hợp; `hyperframes add <exact-name> --dir <project> --no-clipboard --json` tải mã có thể chỉnh sửa và các thành phần phụ thuộc vào dự án. Kiểm tra giấy phép, tài nguyên và script bên ngoài của mục trước khi dùng; khi có thể, thay phụ thuộc từ xa bằng bản cục bộ được phép và không ghi đè file đã chỉnh sửa. Khi ngoại tuyến, không có hoặc không phù hợp, tự dựng hiệu ứng cục bộ. Không gửi phản hồi danh mục hoặc bật tải mô hình khi người dùng chưa yêu cầu.

Đánh giá kết quả như video chuyển động, không chỉ bằng ảnh chụp: xem các đoạn ngắn và chuyển cảnh ở tốc độ bình thường, kiểm tra hành động liên tục và thời điểm âm thanh/phụ đề; sửa lỗi thấy được rồi xuất lại. Kiểm tra kỹ thuật đạt hoặc có MP4 không tự chứng minh chất lượng sáng tạo. Nói rõ đã thực sự kiểm tra gì và giới hạn còn lại.

**Khắc phục và hoàn thành.** Trước tiên kiểm tra hệ điều hành và công cụ trong đúng môi trường thực thi; đừng giả định máy nào cũng có cùng đường dẫn hoặc phần mềm. Ưu tiên công cụ tương thích đã cài hoặc phương án tương đương sẵn có. Nếu cần Python, kiểm tra `python3` và `python`, hoặc trình khởi chạy Windows `py -3`, rồi dùng lệnh hoạt động; không cài Python chỉ để tạo tên lệnh thay thế. Nếu thiếu công cụ kết xuất, trình duyệt, xử lý âm thanh hoặc dịch vụ giọng nói, dùng phương án phù hợp sẵn có hoặc thiết lập riêng cho tác vụ từ nguồn được phép khi có thể; giữ dự án và nêu chính xác điều kiện còn thiếu nếu không có cách dùng được. Nếu kiểm tra HyperFrames thất bại, đọc toàn bộ báo cáo JSON và xem mọi mục, gồm tương phản, chất lượng, runtime và bố cục; phân biệt lỗi với cảnh báo và trường hợp chế độ nghiêm ngặt. Sửa lỗi cụ thể, kiểm tra lại rồi tiếp tục xuất khi người dùng yêu cầu video hoàn chỉnh. Nếu không thể chép lời âm thanh cũ, giữ nguyên tài nguyên gốc và, khi người dùng đã cho phép viết kịch bản mới, tạo lời đọc cùng phụ đề khớp thay vì bỏ dở dự án. Kiểm tra file đã xuất và báo rõ các bước chưa thể kiểm tra.

Với video marketing ngắn chưa có kịch bản cảnh, lập nhịp mở đầu thu hút, giới thiệu sản phẩm hoặc lợi ích, rồi kết thúc bằng lời kêu gọi hành động rõ ràng. Mặc định tạo ít nhất ba nhịp hình ảnh khác nhau, có chuyển động hoặc chuyển cảnh có chủ đích; tôn trọng yêu cầu quay một cảnh hay phong cách khác. Dùng tài nguyên người dùng cung cấp hoặc được phép sử dụng; ghi rõ hình minh họa nếu dễ bị nhầm với sản phẩm hoặc địa điểm thật. Giữ chữ dễ đọc trong vùng an toàn. Xem khung hình đại diện ở đầu, giữa, cuối và các điểm chuyển cảnh; sửa chữ bị cắt, cảnh tĩnh lặp lại và lỗi chính tả trước khi xuất. Nếu có yêu cầu thuyết minh hoặc phụ đề, kiểm tra thời điểm và âm thanh đã xuất; báo rõ phần kiểm tra chất lượng chưa thể thực hiện, không nhận đã nghe hay xem nếu chưa làm.

Với video ngắn, đơn giản và yêu cầu rõ ràng, lập kế hoạch cảnh ngắn rồi tạo dự án ngay. Đọc `references/format.md` và các tài liệu cần cho hiệu ứng được yêu cầu. Với video marketing khi được phép truy cập mạng, trước tiên xem mẫu trong dự án thử: chạy `hyperframes init <scratch-project> --example product-promo --non-interactive --skip-skills` khi CLI hỗ trợ, rồi chọn mẫu nếu phù hợp; dùng `blank` cho thiết kế riêng hoặc khi không có mẫu phù hợp. Tạo dự án bằng `hyperframes init <project> --example <example> --non-interactive --skip-skills`. Thay nội dung và thương hiệu của bên thứ ba trong mẫu; kiểm tra quyền dùng và phụ thuộc bên ngoài. Kiểm tra, xem chuyển động và xuất tệp được yêu cầu. Dùng tài nguyên và phông chữ cục bộ khi người dùng yêu cầu video ngoại tuyến. Nếu không kết xuất được hoặc thiếu công cụ bắt buộc, báo lỗi cụ thể và giữ lại dự án. Mẫu `product-promo` có thể tải tệp từ GitHub; khi yêu cầu ngoại tuyến, dùng mẫu `blank` có sẵn và không thử tải danh mục hoặc mẫu từ xa.

HyperFrames kết xuất HTML thành video bằng cách đưa dòng thời gian tạm dừng tới từng khung hình, để mỗi lần kết xuất cho cùng kết quả; người dùng chỉnh cùng các tệp đó trong bản xem trước Studio. Dùng công cụ này trừ khi được yêu cầu dùng framework khác hoặc ghi trực tiếp trình duyệt. Dùng CLI `hyperframes` đã cài trong môi trường hiện tại; nếu không có, báo rõ công cụ còn thiếu và dùng cách thiết lập hoặc phương án thay thế được phép.

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
- Phim kể chuyện mới dài hơn khoảng 15 giây: đọc tệp theo loại bên dưới rồi `references/story.md`; tự xây dựng cốt truyện phù hợp với yêu cầu; đưa ra các lựa chọn khi người dùng muốn chọn. Sau đó tạo `SPEC.md` (`references/spec.md`): định lượng từng tính từ, nêu các mặc định bị cấm và mô tả cảnh theo khung hình.
- Sau lần sửa cuối: `npx hyperframes check --json`; sửa mọi lỗi, cân nhắc từng cảnh báo. Với phim: xem các khung hình đại diện và điểm chuyển cảnh bằng `npx hyperframes snapshot --at <seconds>` và `references/review.md`, kết thúc bằng `REVIEW.md`. Dùng `npx hyperframes snapshot --review` khi hữu ích; nếu lệnh bị treo, dừng tiến trình do mình tạo và dùng ảnh chụp có chọn lọc, không bỏ qua bước xem hình. Với chỉnh sửa nhỏ: chụp phần đã đổi (`--at`, `--range`, `--composition`) và xem trước khi trả lời.
- Khi người dùng yêu cầu tạo hoặc sửa video, hoàn thành kiểm tra và xem lại hình ảnh, kết xuất video rồi trả tệp trong cuộc trò chuyện StartupBot. Không yêu cầu người dùng mở Studio hoặc URL dự án. Chỉ dùng Studio hoặc gửi liên kết xem trước khi người dùng yêu cầu rõ ràng.

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
