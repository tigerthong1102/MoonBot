# Đối chiếu nhiệm vụ Mobile Standalone

Đối chiếu file giao việc ngày 28/11/2026. Các mục dưới đây bám theo số trong bản gốc. [Báo cáo founder và liên kết PR](startupbot-mobile-standalone-final-report.md) · [Quyết định kiến trúc](../architecture/mobile-standalone-assessment.md)

**Ưu tiên trải nghiệm trên điện thoại.** Bản pilot giữ ba điểm vào trên màn hình hiện có của mỗi nền tảng. Luồng độc lập dùng màn hình chat gốc SwiftUI và Compose sau khi xác minh email. Bản web dùng cùng gateway. [Báo cáo founder](startupbot-mobile-standalone-final-report.md)

Kiểm thử bàn phím hệ thống và trình đọc màn hình trên thiết bị vật lý vẫn còn mở.

## 36 mục của nhiệm vụ

| Mục | Kết quả đã đối chiếu | Công việc còn mở |
|---|---|---|
| 1. Tiêu chuẩn | Chọn hệ thống tài khoản và ví hiện có, định lượng chi phí, dùng reviewer độc lập và dữ liệu thử. | Chưa có cohort khách hàng để đánh giá giá trị kinh doanh. |
| 2. Quyền hạn | Công việc nằm trong feature branches, draft PR và môi trường thử. | Phát hành, chi phí thật và dữ liệu khách hàng cần quyền riêng. |
| 3. Vấn đề onboarding | Companion cũ phụ thuộc host để chạy chat tác vụ. Người mới có điểm vào độc lập trên cả iOS và Android khi cấu hình HTTPS. | Chưa đo tỷ lệ bỏ onboarding. |
| 4. Bốn môi trường | Chat Mobile qua Internet, Desktop qua pairing cũ. Cloud và Local AI là các lựa chọn độc lập. | Chat ngoại tuyến và thực thi Cloud từ hội thoại Mobile chưa được triển khai. |
| 5. Audit | Đã kiểm tra source native, Desktop, issuer, ví, registry, Inbox, giấy phép và upstream. | Chưa chứng nhận mọi bản phát hành hay khả năng phục hồi trên máy khách. |
| 6. Phản biện | ADR ghi lựa chọn shared gateway, native/browser, phân quyền, guest, chi phí và rollback. | Chất lượng model, tỷ lệ quay lại và hiệu quả kinh doanh cần pilot thật. |
| 7. Universal Account | OTP, ID bất biến, owner được issuer xác minh, nhiều phiên, liệt kê và thu hồi một hoặc tất cả phiên. Xác minh lại email sau hết hạn. | Chưa có refresh token riêng ở Mobile, quy trình mất quyền truy cập email, liên kết SSO, MFA hoặc xóa account xuyên subsystem. |
| 8. Onboarding | Email vào chat, credit hoặc trial, điều khiển provider trong phần tùy chọn. 78 nhãn web dùng catalog chung của 16 ngôn ngữ. | Native cần kiểm tra thực địa, đọc màn hình, bàn phím và xoay màn hình. |
| 9. Chat | Stream, stop, retry có định danh, code block, copy, rename/delete, lịch sử theo trang, bounded context. | Model do operator chọn; regenerate, file, thoại, search và memory cá nhân chưa có trên bề mặt mới. |
| 10. Provider | Managed OpenRouter và OAuth PKCE cá nhân có ledger riêng, khóa phiên, cancellation và không tự đổi payer. | ChatGPT cần partner grant, Claude subscription không sử dụng. Chưa có live OAuth/inference, lựa chọn model nâng cao hoặc adapter Mobile cho mọi API. |
| 11. Execution Router | Text skill allowlist, chặn thao tác Desktop được nhận diện, từ chối runtime không được hỗ trợ trước inference. | Chưa có discovery khả năng host trực tuyến hoặc bộ định tuyến hiểu đầy đủ yêu cầu ngôn ngữ tự nhiên. |
| 12. Task state | Mobile turn có trạng thái DB running, complete, limited, interrupted; xác nhận từ stream. Runtime chưa gắn trả lỗi trước dispatch. | Desktop có receipt mở bản nháp, claim một lần và hết hạn theo phiên nhận online. Chưa có trạng thái thực thi chung với Cloud. |
| 13. Thiết bị | Registry theo owner và pairing companion hiện hữu. Phiên đăng nhập và credential máy có vòng đời khác nhau. | Danh sách Mobile chưa chứng minh online, capability hoặc quyền trên máy, chưa thử reconnect vật lý. |
| 14. Đồng bộ | Đồng ý lưu trước gửi, owner-scoped history, pagination, bảo vệ retry và giới hạn lịch sử. | Chưa có selective sync Desktop, merge conflict offline, export toàn account hoặc tự động hết hạn bản backup. |
| 15. Skill | Dùng lại hai skill văn bản trong catalog, giữ LICENSE, chặn skill ngoài allowlist, operator tạm dừng từng skill. | Chưa có manifest capability đa runtime hoàn chỉnh hoặc thực thi skill có approval qua Mobile. |
| 16. Chi phí | Hold trước gọi, settle/reconcile, quota, global cap, trial cohort, trial pause, kill switch, giới hạn input/output và concurrency. | Chưa đủ mọi trục quota ngày/tháng theo token, provider/plan và mọi trường duration/reasoning/cache. Chưa kiểm hóa đơn provider thật. |
| 17. Entitlement | Ví sandbox có credit, subscription, hủy/hoàn tiền; số dư khả dụng, expiry và chi phí BYOK có thể xem trong chat. | Chưa chốt giá, grace policy, store purchase hoặc restore; không coi đăng nhập là quyền inference. |
| 18. Local AI | Đánh giá Apple Foundation Models và LiteRT-LM. Đường Mobile hiện không tải model hoặc fallback sang cloud khi yêu cầu runtime local. | Chưa có runtime Mobile hoặc benchmark RAM, nhiệt, pin, tiếng Việt. |
| 19. Privacy/security | Kiểm owner, mã hóa credential, scope OAuth, consent nêu OpenRouter, giới hạn không có tool, kiểm phụ thuộc. | Retention, export/delete, threat model khi upload, device tests và các dependency advisory còn mở. |
| 20. Tài liệu | Chat chỉ nhận text; user có thể dán nội dung chủ động. Inbox có hệ file riêng. | Chưa nối parser Mobile. Cần quota, MIME, ownership, expiry, isolation và kiểm phép tính tài chính trước phát hành tính năng. |
| 21. Quy mô | Đã đo tải HTTP, stream và SQLite, so sánh 3 triệu dòng, ghi P50/P95/P99. | Chưa đo SLO đa vùng, cold start thiết bị, pin, peak auth hoặc backup tại hạ tầng đích. |
| 22. Growth | Xác định các mốc activation/retention/pairing, chưa thu nội dung chat cho analytics. | Chưa có event pipeline consented hoặc số liệu cohort production. |
| 23. Vận hành | Request ID và CLI budget-status, tuổi các hold, thông báo lỗi và khóa admission. | Chưa có bảng lỗi/rate/duration theo provider, cảnh báo vận hành trực hay diễn tập khôi phục. |
| 24. PR strategy | Tách account/chat, native, PKCE, budget/report và bổ sung kiểm soát sau đối chiếu. | Các PR phụ thuộc nhau; không phát hành riêng một bề mặt native thiếu gateway. |
| 25. Quy trình | Đã có baseline, worktree, code review, lint, typecheck, test, browser smoke, build, audit và rollback. | Tình trạng CI cụ thể nằm trong checks của từng PR. |
| 26. Kiểm thử | Mỗi ca A–L được ghi bên dưới. | Phân biệt fixture, simulator, live provider và hardware. |
| 27. Tải và kinh tế | Mô phỏng bốn quy mô, ba kịch bản và ngân sách miễn phí; có script, số liệu query và HTTP riêng. | Chưa kiểm giá vốn thực tế qua hóa đơn, traffic thật, thuế, store fee hay doanh thu. |
| 28. Review | Reviewer độc lập đã rà soát quyền, chi phí, cancellation/retry, UX và đối chiếu lại đặc tả. | Review production cần kết quả live, thiết bị và policy. |
| 29. Rollout | Origin/PKCE phải bật rõ ràng; issuer và ledger giữ quyền quyết định; trial có cap, skill có thể pause. | Cohort trial giới hạn cấp tiền; rollout theo nhóm cho toàn bộ sản phẩm chưa có. |
| 30. CI | iOS simulator, Android build và unit, macOS host; matrix Ubuntu/Windows theo PR. | Chưa có bản store đã ký hay chứng nhận trên thiết bị vật lý. |
| 31. Definition of Done | Đối chiếu P0/P1/P2 bên dưới. | P0 toàn sản phẩm còn mở. |
| 32. NO-GO | Nội bộ dùng fixture có thể chạy; public beta và production bị chặn. | Phải chứng minh live provider, thiết bị, chính sách dữ liệu/store, CI và vận hành. |
| 33. Phản biện sau triển khai | Báo cáo trả lời về đường chat, bước đầu, chi phí, scale, lợi thế, skill, quyết định và ba kịch bản. | Chưa thể khẳng định tăng trưởng hoặc chất lượng thương mại. |
| 34. Báo cáo | Báo cáo tiếng Việt có các phần A–H, số liệu, ảnh và liên kết. | Các bằng chứng chưa chạy được ghi theo phạm vi. |
| 35. Giới hạn | Dùng provider giả cho test và issuer thật ở local; draft PR; không dùng dữ liệu khách hàng. | Mọi tính năng thương mại vẫn chịu các điều kiện trong báo cáo. |
| 36. Thực thi | Có mã chạy được, test và PR; lần đọc lại đã phát hiện và bổ sung quản lý phiên, kiểm soát skill/trial, runtime và số liệu P99. | Hạng mục có thể làm bằng phần mềm nhưng còn thiếu được ghi là chưa triển khai; credential, policy và hardware là các blocker riêng. |

## Nhóm kiểm thử A–L

Mỗi dòng là **một ca trong file gốc**. PASS chỉ áp dụng cho môi trường ở đầu nhóm. PARTIAL có một phần bằng chứng hoặc test thay thế. BLOCKED cần điều kiện ngoài môi trường thử. NOT RUN là chưa chạy, DEFERRED là chức năng chưa bật. Số ca này độc lập với số assertion/test tự động.

### A. New Mobile User

Simulator/Android CI xác minh điểm vào; browser Chrome + email sink, issuer local và provider giả xác minh chat. Đóng/mở tiến trình app và đăng nhập lại trên hardware chưa chạy.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| A1 | Cài app mới | PARTIAL |
| A2 | Không có Desktop | PASS trong phạm vi ghi rõ |
| A3 | Không có Cloud Agent | PASS trong phạm vi ghi rõ |
| A4 | Đăng ký email | PASS trong phạm vi ghi rõ |
| A5 | Xác thực email | PASS trong phạm vi ghi rõ |
| A6 | Đăng nhập | PASS trong phạm vi ghi rõ |
| A7 | Gửi tin nhắn đầu tiên | PASS trong phạm vi ghi rõ |
| A8 | Nhận streaming response | PASS trong phạm vi ghi rõ |
| A9 | Tạo hội thoại mới | PASS trong phạm vi ghi rõ |
| A10 | Đóng app | NOT RUN |
| A11 | Mở lại app | NOT RUN |
| A12 | Kiểm tra lịch sử | PASS trong phạm vi ghi rõ |
| A13 | Logout | PASS trong phạm vi ghi rõ |
| A14 | Login lại | PARTIAL |

### B. Multi-device

Hai cookie khác nhau của cùng owner có thể đọc lịch sử và thu hồi phiên; workerd kiểm hai user với bearer thật. Cặp hai điện thoại vật lý, thu hồi máy đã ghép và kiểm traffic Desktop local-only chưa được nghiệm thu end-to-end.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| B1 | Tạo tài khoản trên iPhone | BLOCKED |
| B2 | Đăng nhập cùng tài khoản trên thiết bị khác | PARTIAL |
| B3 | Kiểm tra session | PASS trong phạm vi ghi rõ |
| B4 | Kiểm tra dữ liệu được phép đồng bộ | PASS trong phạm vi ghi rõ |
| B5 | Kiểm tra dữ liệu local-only không bị upload | NOT RUN |
| B6 | Logout khỏi một thiết bị | PASS trong phạm vi ghi rõ |
| B7 | Logout khỏi tất cả thiết bị | PASS trong phạm vi ghi rõ |
| B8 | Thu hồi quyền thiết bị | PARTIAL |

### C. Desktop Offline

Chat độc lập chạy khi không có host. Thông báo desktop_required được kiểm ở gateway và browser. Chuyển một Desktop thật từ online sang offline rồi reconnect chưa có kết quả. Queue chưa bật.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| C1 | Kết nối Desktop | PARTIAL |
| C2 | Chat bình thường | PASS trong phạm vi ghi rõ |
| C3 | Tắt Desktop | NOT RUN |
| C4 | Tiếp tục chat Mobile | PARTIAL |
| C5 | Yêu cầu task cần Desktop | PASS trong phạm vi ghi rõ |
| C6 | Kiểm tra thông báo đúng | PASS trong phạm vi ghi rõ |
| C7 | Kiểm tra không báo thành công giả | PASS trong phạm vi ghi rõ |
| C8 | Bật Desktop | NOT RUN |
| C9 | Kiểm tra reconnect | NOT RUN |
| C10 | Kiểm tra task queue nếu được hỗ trợ | DEFERRED |

### D. Desktop Existing Users

Smoke desktop trên macOS tạo bot, gửi, chờ, đọc lại bằng fake engine. Ấn bản đã cài của khách, ghép đôi native và dữ liệu của ứng dụng cũ chưa được thử trực tiếp.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| D1 | Người dùng cũ mở Desktop | NOT RUN |
| D2 | Sử dụng chế độ local hiện có | PARTIAL |
| D3 | Sử dụng tính năng đã tồn tại | PASS trong phạm vi ghi rõ |
| D4 | Kết nối Mobile theo phương thức cũ nếu được duy trì | NOT RUN |
| D5 | Kiểm tra không mất dữ liệu | PARTIAL |
| D6 | Kiểm tra không bị ép dùng Cloud Agent | PASS trong phạm vi ghi rõ |
| D7 | Kiểm tra không có regression nghiêm trọng | PARTIAL |

### E. Provider

Managed/BYOK dùng provider fixture và issuer local. PKCE kiểm state, key có cap và payer theo thread. Hết quota, rate limit và disconnect đã kiểm. API key thật, timeout/model gỡ khỏi catalog thực tế chưa được xác nhận.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| E1 | Managed AI hoạt động | PARTIAL |
| E2 | API key hợp lệ | PARTIAL |
| E3 | API key không hợp lệ | NOT RUN |
| E4 | Provider timeout | PARTIAL |
| E5 | Provider unavailable | PARTIAL |
| E6 | Model unavailable | NOT RUN |
| E7 | Rate limit | PASS trong phạm vi ghi rõ |
| E8 | Quota exhausted | PASS trong phạm vi ghi rõ |
| E9 | Credential revoked | PARTIAL |
| E10 | Provider switch | PASS trong phạm vi ghi rõ |
| E11 | BYOK usage attribution | PASS trong phạm vi ghi rõ |
| E12 | Fallback permission | PASS trong phạm vi ghi rõ |
| E13 | Không có silent fallback gây phát sinh chi phí hoặc lộ dữ liệu | PASS trong phạm vi ghi rõ |

### F. Cost

Thử cạnh tranh, reserve, cap UTC, abort/stream đứt, retry, context, trial cohort và kill switch. Route text chỉ có một model call; settle dùng usage giả, chưa có đối chiếu hóa đơn live.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| F1 | User vượt quota | PASS trong phạm vi ghi rõ |
| F2 | Nhiều request đồng thời | PASS trong phạm vi ghi rõ |
| F3 | Request bị timeout | PARTIAL |
| F4 | Streaming bị gián đoạn | PASS trong phạm vi ghi rõ |
| F5 | Duplicate retry | PASS trong phạm vi ghi rõ |
| F6 | Context quá dài | PASS trong phạm vi ghi rõ |
| F7 | Tool loop | PARTIAL |
| F8 | Free abuse | PARTIAL |
| F9 | Budget reservation | PASS trong phạm vi ghi rõ |
| F10 | Actual usage reconciliation | PARTIAL |
| F11 | Global budget exhausted | PASS trong phạm vi ghi rõ |
| F12 | Kill switch hoạt động | PASS trong phạm vi ghi rõ |

### G. Skill

Có text allowlist và kill riêng skill. Chặn runtime document/cloud tại API; không có parser hoặc runtime thực thi hai loại skill này. Không có đường xin approval Desktop từ chat này.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| G1 | Skill chỉ cần chat | PASS trong phạm vi ghi rõ |
| G2 | Skill cần file upload | PARTIAL |
| G3 | Skill cần Desktop | PASS trong phạm vi ghi rõ |
| G4 | Skill cần Cloud | PARTIAL |
| G5 | Skill thiếu permission | PARTIAL |
| G6 | Skill yêu cầu approval | DEFERRED |
| G7 | Skill runtime unavailable | PASS trong phạm vi ghi rõ |
| G8 | Skill manifest không hợp lệ | PARTIAL |
| G9 | Skill bị tắt bằng feature flag | PASS trong phạm vi ghi rõ |

### H. Security

Đã thử hai owner, mismatch account, OAuth một lần, token bị thu hồi. Quét diff các mẫu secret và kiểm payload session. Chưa làm kiểm chứng log runtime toàn hệ thống, pairing replay hay prompt injection thực nghiệm với model thật. Upload/custom endpoint chưa có.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| H1 | User A truy cập conversation của User B | PASS trong phạm vi ghi rõ |
| H2 | User A truy cập file của User B | PARTIAL |
| H3 | User A điều khiển Desktop của User B | PARTIAL |
| H4 | Giả mạo user ID | PASS trong phạm vi ghi rõ |
| H5 | Giả mạo device ID | NOT RUN |
| H6 | Replay pairing code | NOT RUN |
| H7 | OAuth state sai | PASS trong phạm vi ghi rõ |
| H8 | Token hết hạn | PARTIAL |
| H9 | Token bị revoke | PASS trong phạm vi ghi rõ |
| H10 | Prompt injection yêu cầu đọc secret | NOT RUN |
| H11 | Prompt injection yêu cầu thực thi command ngoài quyền | NOT RUN |
| H12 | Kiểm tra API key không xuất hiện trong log | PARTIAL |
| H13 | Kiểm tra file upload độc hại | DEFERRED |
| H14 | Kiểm tra SSRF nếu hỗ trợ custom endpoint | DEFERRED |
| H15 | Kiểm tra tenant isolation | PASS trong phạm vi ghi rõ |

### I. Network và Mobile Lifecycle

Có stream lỗi khi mất kết nối fixture, idempotency, đọc lịch sử sau reload. Không thay việc đo handoff mạng di động, RAM, OS background/foreground/kill.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| I1 | Wi-Fi sang 4G/5G | BLOCKED |
| I2 | Mất mạng giữa streaming | PASS trong phạm vi ghi rõ |
| I3 | Network latency cao | NOT RUN |
| I4 | App background | NOT RUN |
| I5 | App foreground | NOT RUN |
| I6 | Force close | NOT RUN |
| I7 | App restart | NOT RUN |
| I8 | Retry | PASS trong phạm vi ghi rõ |
| I9 | Duplicate event | PARTIAL |
| I10 | Session expiration | PARTIAL |
| I11 | Low-memory condition | NOT RUN |

### J. Localization và Accessibility

Chrome tiếng Việt, 320 px, dark và font 125%; nhãn Anh/Bồ Đào Nha có trong code. CI native kiểm onboarding. Hardware screen reader, bàn phím hệ thống và xoay orientation chưa nghiệm thu.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| J1 | Tiếng Việt | PASS trong phạm vi ghi rõ |
| J2 | Tiếng Anh | PARTIAL |
| J3 | Các ngôn ngữ hiện có | PARTIAL |
| J4 | Dark mode | PASS trong phạm vi ghi rõ |
| J5 | Light mode | PARTIAL |
| J6 | Font size lớn | PASS trong phạm vi ghi rõ |
| J7 | Screen reader | BLOCKED |
| J8 | Màn hình nhỏ | PASS trong phạm vi ghi rõ |
| J9 | Bàn phím | PARTIAL |
| J10 | Orientation nếu hỗ trợ | NOT RUN |

### K. Billing và Account Lifecycle

Ví sandbox kiểm grant, subscription hết hạn, cancellation/refund. Revoke phiên đã thử ở issuer; delete thread có kết quả. Xóa account xuyên D1, Inbox, SQLite, backup và restore purchase cần policy/store.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| K1 | Plan entitlement | PASS trong phạm vi ghi rõ |
| K2 | Trial expiration | PARTIAL |
| K3 | Subscription expiration | PASS trong phạm vi ghi rõ |
| K4 | Restore purchases nếu đã tích hợp | BLOCKED |
| K5 | Cancellation | PASS trong phạm vi ghi rõ |
| K6 | Account deletion | BLOCKED |
| K7 | Revocation | PASS trong phạm vi ghi rõ |
| K8 | Data deletion flow | PARTIAL |
| K9 | Không truy cập được account đã bị vô hiệu hóa | PARTIAL |

### L. Migration và Rollback

Ledger cũ có token/số dư được mở bằng code mới và cũ; backfill/rollback transaction có test. Chưa kiểm migration mọi native pairing, legacy history và egress toàn Desktop.

| Ca | Yêu cầu gốc | Kết quả |
|---|---|---|
| L1 | Fresh install | PARTIAL |
| L2 | Upgrade từ phiên bản cũ | PARTIAL |
| L3 | Existing database | PASS trong phạm vi ghi rõ |
| L4 | Existing conversation | PARTIAL |
| L5 | Existing Desktop pairing | NOT RUN |
| L6 | Migration failure | PASS trong phạm vi ghi rõ |
| L7 | Rollback | PASS trong phạm vi ghi rõ |
| L8 | Không mất dữ liệu | PARTIAL |
| L9 | Không tạo account trùng | PARTIAL |
| L10 | Không upload dữ liệu ngoài ý muốn | NOT RUN |

**Tổng theo ca trong đặc tả**. 56 PASS trong phạm vi ghi rõ, 40 PARTIAL, 23 NOT RUN, 5 BLOCKED, 4 DEFERRED. Tổng 128 ca.

## Definition of Done ở mục 31

### P0

Kết quả nội bộ từ workerd, gateway, browser, simulator và regression suite; inference, Desktop offline, toàn bộ ngôn ngữ tự nhiên, bảo mật vận hành và phần cứng thật còn thiếu.

| Điều kiện | Kết quả |
|---|---|
| Người dùng có thể đăng ký StartupBot bằng email | PASS trong phạm vi ghi rõ |
| Người dùng có thể đăng nhập mà không cần Desktop | PASS trong phạm vi ghi rõ |
| Người dùng có thể chat mà không cần Cloud Agent | PARTIAL |
| Mobile không bị khóa khi không có máy tính | PASS trong phạm vi ghi rõ |
| Managed AI hoạt động với tài khoản đủ entitlement | PARTIAL |
| API key được bảo vệ | PARTIAL |
| Authentication và authorization được kiểm thử | PASS trong phạm vi ghi rõ |
| Chat streaming hoạt động | PASS trong phạm vi ghi rõ |
| Conversation history hoạt động theo chính sách đã chọn | PASS trong phạm vi ghi rõ |
| Desktop offline không làm hỏng Mobile Chat | PARTIAL |
| Task cần Desktop được nhận diện đúng | PARTIAL |
| Không báo thành công giả cho task chưa thực thi | PARTIAL |
| Existing Desktop functionality không có regression nghiêm trọng | PARTIAL |
| Chi phí API có quota và budget control | PASS trong phạm vi ghi rõ |
| Có global kill switch | PASS trong phạm vi ghi rõ |
| Có rate limiting và abuse prevention phù hợp | PARTIAL |
| Không có lỗi bảo mật nghiêm trọng chưa xử lý trong phạm vi phát hành | PARTIAL |
| Migration được kiểm thử | PASS trong phạm vi ghi rõ |
| Có rollback plan | PASS trong phạm vi ghi rõ |
| Automated test phù hợp đã được chạy | PASS trong phạm vi ghi rõ |
| Smoke test phù hợp đã được thực hiện | PASS trong phạm vi ghi rõ |
| Documentation được cập nhật | PASS trong phạm vi ghi rõ |
| PR có bằng chứng kiểm thử thực tế | PASS trong phạm vi ghi rõ |

### P1

Cần chứng cứ trên thiết bị, provider thật, sự đồng ý thu analytics hoặc chính sách thương mại. OTP, registry và chọn payer có phạm vi hẹp hơn SSO, đồng bộ Desktop và billing store.

| Điều kiện | Kết quả |
|---|---|
| Social login phù hợp | BLOCKED |
| BYOK | PARTIAL |
| OpenRouter connection chính thức nếu được phép | PARTIAL |
| Device management | PARTIAL |
| Mobile-compatible skills | PASS trong phạm vi ghi rõ |
| Capability-based execution | PARTIAL |
| Selective synchronization | PARTIAL |
| Product analytics | NOT RUN |
| Provider management | PARTIAL |
| Subscription entitlement | PARTIAL |
| Mobile-to-Desktop conversion flow | PARTIAL |

### P2

Đã có web chat chung mở bằng HTTPS. Local AI/handoff nâng cao/push cho chat độc lập chưa bật.

| Điều kiện | Kết quả |
|---|---|
| Mobile Local AI nếu đủ khả năng | DEFERRED |
| Cloud Agent nâng cao | DEFERRED |
| Additional provider integrations | DEFERRED |
| Web client nếu phù hợp | PARTIAL |
| Deferred automation nâng cao | DEFERRED |
| Push notification và các tính năng mở rộng | DEFERRED |

## 20 câu hỏi sau triển khai ở mục 33

| # | Kết luận cho founder |
|---|---|
| 1 | Chưa nghiệm thu độc lập trên điện thoại vật lý. Đã chạy được browser mobile với issuer local, iOS simulator và Android CI. |
| 2 | Chat văn bản độc lập với Desktop session. |
| 3 | Chat cần Internet, shared gateway và entitlement/provider hợp lệ. Không cần VM Cloud Agent. |
| 4 | Có bốn chặng trong pilot từ mở mục chat, nhập email, xác nhận OTP đến viết/đồng ý/gửi. Thời gian tới giá trị đầu tiên trên mạng thật chưa đo. |
| 5 | Luồng mới giải quyết người dùng chưa có Desktop. Hai app dùng chung web UI nên trải nghiệm system browser cần nghiệm thu riêng. |
| 6 | Thêm email, inference, ghi SQLite và traffic theo usage. Chưa có hóa đơn production; xem ba kịch bản ở báo cáo F. |
| 7 | Một bề mặt chat trong gateway hiện có và hai điểm vào native. Cần vận hành issuer, email, TLS, volume, backup và provider. |
| 8 | Chi phí xây dựng thêm giảm nhờ dùng chung UI/issuer/ledger. Thêm orchestration đa vùng, VM mỗi user hoặc engine kép lúc này sẽ tăng vận hành. |
| 9 | 100.000 MAU ở 30 request/tháng tương đương trung bình 1,16 request/s. Phải đo peak, đồng thời, RTT, write throughput, restore và cap. |
| 10 | 1 triệu MAU có thể gây nghẽn issuer/OTP, duration stream, writer SQLite và storage. Chưa có capacity chứng nhận. |
| 11 | Chưa chứng minh lợi thế cạnh tranh với chatbot khác. Giả thuyết là từ bản nháp sang workflow máy tính có phân quyền. |
| 12 | Đo từ gợi ý ghép nối tới pairing thực và workflow có kết quả. Chưa có số chuyển đổi. |
| 13 | Hai ứng viên có thể thử ngay là lập chiến dịch và soạn thư tiếp cận. Chưa có dữ liệu retention/giá trị để xếp hạng. |
| 14 | Hoãn private VM, Local AI đại trà, tự động MISA, queue không có approval, file nhạy cảm và thêm nhiều provider chưa được cấp phép. |
| 15 | Ưu tiên policy runtime theo capability, luồng session/xóa dữ liệu, quản trị quota và xử lý stream khi background trước khi mở rộng. |
| 16 | Rủi ro còn lại gồm chiếm email, transcript/backup, OTP egress chung, supply chain, cost sau timeout, billing/store và duty xử lý nội dung AI. |
| 17 | Đang chờ credential staging, ngân sách provider, thiết bị vật lý và quyền đối tác cho ChatGPT; không phụ thuộc các quyền này để chạy fixture. |
| 18 | GO cho người kiểm thử nội bộ với dữ liệu giả và môi trường cô lập. Bản phát hành cho người dùng nội bộ trên điện thoại thật chưa được ký/nghiệm thu. |
| 19 | NO-GO public beta do live provider, hardware, policy xóa dữ liệu, OTP/load và các điều kiện store. |
| 20 | NO-GO production cho tới khi xong các cổng beta cùng đối soát, restore, monitoring và phê duyệt. |

## Những quyết định vẫn thuộc đội kỹ thuật

- Thiết kế refresh/reauth, xóa/export account theo từng kho, định danh task và receipt qua runtime, kiểm shared issuer, rate limiting và privacy regression ở Desktop local-only.
- Cho analytics tối thiểu, xác định cohort theo ngày, lấy tài khoản đồng ý làm mẫu số, một event duy nhất cho first response hoàn tất; tính D1/D7/D30 theo lần quay lại và tỷ lệ ghép đôi thành công theo số user đã nhận lời mời. Chưa có pipeline thu thập hoặc dữ liệu growth thật.
- Phân loại các lỗi vận hành theo nhóm mã chuẩn và request ID. Giữ lý do block/approve, xác nhận provider cost, cache/reasoning nếu provider trả về và duration với thiết kế redaction; chưa có đủ toàn bộ metric. Trước launch phải thử sự cố/quá tải/restore và quy trình tiếp nhận báo cáo nội dung ngay trong app.
- Kiểm thử handoff trên máy thật, store restore và yêu cầu xóa tài khoản xuyên hệ sinh thái sau khi có chính sách và quyền phục vụ người dùng. Những hạng mục này chưa được tính hoàn thành.
