# PR1 — StartupBot Cloud OSS, Fly.io và readiness audit

**Ngày kiểm toán:** 20/11/2026 (UTC+7)  
**Baseline:** [`79709c740a71bdd3acc8c81d7ff3b7555b2ee15b`](https://github.com/tigerthong1102/MoonBot/tree/79709c740a71bdd3acc8c81d7ff3b7555b2ee15b) (`main`, tại thời điểm bắt đầu kiểm toán)  
**Phạm vi:** Chỉ kiểm toán và thiết kế kiểm thử. **Không** cấp máy, đổi Cloudflare/Fly, nạp credits, sửa cấu hình production hoặc merge.  
**Kết luận:** **NO-GO** bán gói StartupBot $20/tháng gồm Cloud + AI ở trạng thái đã kiểm tra. OSS Cloud runtime có nền tảng đáng kể, nhưng chưa có bằng chứng hoàn thiện commercial control plane, metering/quotas cứng, isolation acceptance và live capacity benchmark.

## 1. Phát hiện theo mức độ ưu tiên

| ID | Mức | Phát hiện | Bằng chứng / xử lý bắt buộc |
|---|---|---|---|
| C-01 | **P0** | Không có bằng chứng StartupBot sở hữu hoặc triển khai bộ **Cloud Admin** quản lý lifecycle/payment/provisioning. Cloud home chỉ là một phần giao thức; tài liệu tham chiếu repo `openmaus-cloud` ngoài cây nguồn. | [docs/cloud-pro.md#L14-L35](../cloud-pro.md); cần tự xây và kiểm nghiệm admin, hoặc có hợp đồng nguồn/host rõ ràng. Không dùng endpoint/dịch vụ upstream khi chưa được phép. |
| C-02 | **P0** | Desktop StartupBot đang cố ý **chặn Cloud đăng nhập thật**: `ensureCloudAccount` truyền `fetch: unavailableStartupBotCloud`; hàm này luôn throw `StartupBot Cloud is not configured`. | [electron/main.mjs](../../electron/main.mjs) dòng 791–798; [electron/startupbot-identity.mjs](../../electron/startupbot-identity.mjs) dòng 36–38. Không coi giao diện Cloud là sản phẩm đã bán được. |
| C-03 | **P0** | Cloudflare control plane trong repo **không phải bộ cấp Fly VM**: nó quản lý tài khoản cài đặt và Cloudflare Tunnel cho desktop; `wrangler.jsonc` giữ account ID, hostname, zone, sender, relay và tên dự án upstream. | [README](../../cloudflare/control-plane/README.md) dòng 1–30; [wrangler.jsonc](../../cloudflare/control-plane/wrangler.jsonc) dòng 3–21, 70–76. **Không deploy** cấu hình upstream; tạo môi trường, credentials và domain StartupBot riêng, không copy secrets. |
| C-04 | **P0** | Fly config `deploy/fly/fly.toml` là **mỗi khách một app + 2 GB RAM/10 GB volume + luôn chạy** (`auto_stop_machines="off"`, `min_machines_running=1`). Không đáp ứng lời hứa 4 GB RAM/25 GB và không kinh tế khi bao AI. | [deploy/fly/fly.toml](../../deploy/fly/fly.toml) dòng 1–58. Giữ nguyên baseline, mở provider adapter mới ở PR khác, benchmark trước. |
| C-05 | **P0** | Cloud home **không gộp AI trả phí**, chỉ cho người dùng kết nối subscription/API riêng (trừ trial credit ngắn). | [docs/cloud-pro.md](../cloud-pro.md) dòng 14–19; [server/cloud-home.ts](../../server/cloud-home.ts) dòng 1–20; [deploy/fly/fly.toml](../../deploy/fly/fly.toml) dòng 16–21. Cần gateway/billing riêng với chính sách và quyền thương mại của model provider. |
| C-06 | **P0** | Usage caps OSS là **ước tính**, không có cap mặc định, mặc định chỉ chặn unattended; một turn đang chạy được phép vượt mức. Không đáp ứng **hard stop tính tiền** cho mỗi thuê bao $20. | [docs/usage-caps.md](../usage-caps.md) dòng 1–46, 132–144. Cần reservation ledger nguyên tử, max output/tool budgets, provider reconciliation, quota toàn tenant và kill switch. |
| C-07 | **P0** | OSS Apache-2.0 có thể dùng thương mại theo điều kiện, nhưng **Enterprise** có license riêng cấm hosted/resell/white-label không có partner agreement. Enterprise không còn trong cây hiện tại, **nội dung lịch sử fork và clearance artifact chưa giải quyết**. | [LICENSING.md](../../LICENSING.md), [LICENSE_GAP.md](../../LICENSE_GAP.md), [docs/audits/commercial-readiness.md](../audits/commercial-readiness.md), [upstream enterprise/LICENSE](https://github.com/milind-soni/OpenMausBot/blob/main/enterprise/LICENSE). Phê duyệt quyền phân phối & danh mục binary theo từng artifact trước bán. |
| C-08 | **P0** | Không thể coi CI là chứng minh isolation production. `fleet` có code cấp workspace cho từng OS user, nhưng live test root→tenant, systemd, nftables, Caddy **chưa được chạy** trong CI. | [docs/verification/fleet.md](../verification/fleet.md) dòng 1–122. Phải thử hai tenant thật trên VPS cách ly, cả truy cập ngang, file, token, service restart, crash và rollback. |
| C-09 | **P0** | Bot-box bubblewrap tự phát hiện: có thể trả `off` khi kernel không hỗ trợ user namespaces hoặc bwrap không chạy; trên Cloud muốn cung cấp code execution cho người dùng không tin cậy phải **admission fail-closed** nếu sandbox check không đạt. | [server/bot-box/detect.ts](../../server/bot-box/detect.ts) dòng 1–74; [docs/bot-box.md](../bot-box.md) dòng 51–80. Điều kiện chấp nhận: real bwrap, self-check 23/23, egress và canary không lọt. |
| C-10 | **P1** | Cơ chế ngủ của Cloud home có giao thức nhưng **Admin bên ngoài** mới là bên polling, suspend/wake và đánh thức lịch chạy. Không có chứng minh vận hành thật từ repo này. | [server/cloud-power.ts](../../server/cloud-power.ts) dòng 1–55; [docs/cloud-pro.md](../cloud-pro.md). Thử cron, webhook, background, long-running task, reconnect, mất điện, restore. |
| C-11 | **P1** | Web portal của StartupBot có workspace riêng nhưng `Provisioning is manual in this preview`; chưa có orchestration sản xuất. | [startupbot-site/README.md](../../startupbot-site/README.md) dòng 56–66. Thêm luồng trả tiền → provision → assigned identity → key rotation → suspend → delete/refund. |
| C-12 | **P1** | Preview mua Cloud có dữ liệu giá **mock** $15/$49/$99, không phải bảng giá thương mại StartupBot $20. | [src/cloud-buy-preview.tsx](../../src/cloud-buy-preview.tsx) dòng 1–29. Không dùng preview làm bằng chứng billing/entitlements. |
| C-13 | **P1** | Giao diện, đường API, tên service và tài liệu vẫn chứa nhận diện upstream; phải bảo đảm không gọi upstream vô ý và không lấy logo/brand bảo hộ. | [BRANDING_AUDIT.md](../../BRANDING_AUDIT.md), [LICENSE_GAP.md](../../LICENSE_GAP.md), [electron/cloud-account.mjs](../../electron/cloud-account.mjs). |

## 2. Thành phần đã tồn tại và tái sử dụng được

- **Cloud home runtime:** `Dockerfile --target cloud-home`, `server/cloud-home.ts`, Caddy/TLS, volume và cấu hình Fly. Docker CI có bài smoke build, boot, pairing HMAC và không có enterprise.
- **Sleep contract:** `server/cloud-power.ts` báo busy/idle và `nextDueAt` cho scheduler; phần điều phối bên ngoài còn thiếu.
- **Sandbox:** bubblewrap per turn, egress gate, canary self-check; không được diễn giải source/test giả lập thành certification trên Fly production.
- **Fleet dùng chung VPS:** `server/fleet.ts`, fleet agent/CLI, per-OS-user workspace, Caddy và nftables fence; offline tests có, live disposable VPS chưa được chứng minh.
- **Workspace web:** `startupbot-site` có quy trình pairing và sign-in mô phỏng; cấp workspace hiện thủ công.
- **Usage/UI:** ledger AI và usage caps OSS; không phải commercial billing ledger.
- **Control plane Cloudflare:** identity, tunnel, relay và OTP cho desktop; **không** tương đương Cloud subscription/control plane cho VPS.

## 3. Bằng chứng CI đúng SHA

- **Main:** `79709c740a71bdd3acc8c81d7ff3b7555b2ee15b`.
- **Push run [44653179963](https://github.com/tigerthong1102/MoonBot/actions/runs/44653179963): FAILED.** Hai lỗi: Ubuntu shard 4/8, test `server/index.test.ts` — competing server did not exit; Ubuntu shard 5/8, `server/decider-rooms.e2e.test.ts` — assertion OpenRouter pick. Không tự suy luận đây chắc chắn là flake.
- **Scheduled full run [44660015795](https://github.com/tigerthong1102/MoonBot/actions/runs/44660015795): SUCCESS** cùng main SHA, bao gồm kiểm thử control-plane, OSS-no-enterprise, packaged server và shards. Điều này chứng minh bộ test tự động có thể PASS ở cùng commit, **không** thay thế điều tra hai lỗi push run và không chứng minh deploy với Fly thật.
- **CI Linux:** workflow `.github/workflows/ci.yml` dòng 201–207 nêu rõ Ubuntu 24.04 được dùng thay vì 26.04 vì user namespace/bubblewrap; một số real-box tests chạy unboxed hoặc skip. Không dùng số lượng test PASS để tuyên bố tenant isolation trên production.
- **Không chạy live benchmark trong audit này**: không có Fly deployment/credentials, repo local checkout và tài nguyên VM thực trong phiên kiểm toán; không tính RAM/CPU thật hoặc hóa đơn thật bằng ước đoán.

## 4. Economics — chỉ để đặt ngưỡng benchmark

**Giá tham chiếu Fly Machines áp dụng từ 01/10/2026, region cơ sở; kiểm tra lại region trước mua:** [Fly Pricing Update](https://fly.io/pricing-update/).

- Baseline `shared-cpu-1x`, RAM 2 GB và volume 10 GB, bật 730 giờ: compute xấp xỉ $2.19 + (2 − 0.25) × $6 = **$12.69**; volume 10 × $0.15 = **$1.50**; tổng **$14.19/user/tháng** (chưa backup, traffic, IP, tax).
- Mục tiêu 2 shared vCPU, 4 GB RAM và volume 25 GB, bật 730 giờ: compute $4.39 + (4 − 0.5) × $6 = **$25.39**; volume **$3.75**; tổng **$29.14/user/tháng**.
- Với 2 GB baseline + $6 AI + $4 affiliate + $0.80 payment, gói $20 còn **âm $4.99** trước phí nạp API, support và tax.
- Đây là **giá lý thuyết**, không phải invoice/benchmark. Kế hoạch chỉ có thể có lời nếu tài nguyên máy giảm khi idle, quota thực và usage average phù hợp. Volume provisioned vẫn tính phí khi Machine stop; Sprites được tính khác, cần proof of compatibility trước chuyển.

## 5. Live benchmark cần thực hiện (bắt buộc trước PR2/launch)

**Môi trường:** hai máy Fly khu vực dự định phục vụ VN (một `shared-cpu-1x/2GB/10GB`, một 4GB với disk tối thiểu); một disposable VPS `fleet` Ubuntu 24.04; model mock/fake engine trước, API thật với hạn mức riêng sau khi được phép.

1. Ghi SHA ảnh, image digest, region, instance size, kernel/userns/bwrap, volume, network egress và version Agent; không xuất secrets.
2. Chạy 0/1/5/20 concurrent Agents + 100 tenants provisioned; đo `RSS/PSS` process, RAM peak, CPU seconds, CPU throttling, p50/p95 latency, startup-to-first-response, time-to-sleep/wake, file size, IOPS, network và token usage.
3. Workloads: idle, chat, memory recall, write file, single Chrome, 5 Chrome concurrent, MCP, scheduled run, webhook, backup+restore, long-running task, crash/OOM, volume pressure và forced suspend.
4. Isolation: alpha không đọc beta filesystem/DB, không truy cập loopback beta, metadata, cloud/control-plane secrets, Docker socket, provider key; kiểm `box 23/23` và fail-closed khi bwrap unavailable.
5. Billing: tạo 10, 100, 1.000 concurrent reservations giả lập, kiểm retry/idempotency và cắt chi tiêu qua nhiều Agent/user/session; reconcile provider charges & refunds. Không lấy self-reported fleet ledger làm nguồn tính tiền.
6. Autosuspend: home không ngủ khi còn live-turn/Chrome/backup; cron/webhook đánh thức đúng lịch; sau wake dữ liệu và credential còn nguyên; tính CPU/RAM-giờ + disk thực.
7. Failure: kill server, fail DNS, lose Caddy, simulate timeouts/retry, disk full, account delinquent, delete/restore; không orphan tài nguyên trả phí.
8. Ghi `baseline.json`, raw metrics đã ẩn danh, test matrix, ngày, giờ và bill estimate có vùng; nếu không có môi trường thực, trạng thái **NOT RUN** chứ không PASS.

**Đề xuất yêu cầu nghiệm thu ban đầu:** 0 rò rỉ chéo tenant, 0 lộ credential, 0 orphan billable sau cleanup, hard quota không overrun ngoài reservation đã được phê duyệt, wake/schedule phục hồi có kiểm tra, chưa phát hành khi bất kỳ P0 nào còn mở. Ngưỡng SLA/latency và cloud budget phải lấy từ kết quả pilot thực, không ấn định từ mã nguồn.

## 6. Định hướng PR tiếp theo (không triển khai trong PR1)

- **PR2**: tách commercial control plane độc lập thuộc StartupBot; adapter provider (Fly Machines trước vì Cloud home đã có hợp đồng, Sprites POC song song); kiểm thử fail-closed.
- **PR3**: subscription and quota ledger cứng, gateway OpenRouter theo điều khoản/giấy phép được chấp thuận, finance reconciliation; không cấp API key master cho tenant.
- **PR4**: provisioning lifecycle, per-tenant secrets, backups, deletion, suspended/active billing, autosleep scheduler, limited concurrency.
- **PR5**: bench thật 100 tenants + capacity/abuse/chaos, billing cap, restore, end-to-end before paid release.

**Giới hạn phạm vi:** Báo cáo là kiểm toán tĩnh trên GitHub, tài liệu/CI đã phát hành. Chưa phải audit an ninh độc lập, ý kiến pháp lý, quyền thương mại được xác nhận hoặc chứng nhận chi phí/SLA Cloud thật.
