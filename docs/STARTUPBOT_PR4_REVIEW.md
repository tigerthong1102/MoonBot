# Independent PR #4 code review

Base: main `29c86dfb25cd7c2e544d4fc73aacbc54f993edfc`. Prior head: `271fdc7fae445cf2d820e492035ecc54c7b94c02`.
The entire PR diff was reviewed by subsystem, rather than treating a bot receipt as proof. PR #4 remains Ready at the owner's request; no mobile merge or public release is authorized. The fix SHA and exact-head evidence are recorded in the PR description after verification.

## Confirmed findings

| Priority | Finding | Correction and regressions |
| --- | --- | --- |
| High | Android stale HTTP state/results/errors crossed computer/runtime boundaries | Capture actual client identity and gate accepted roster, task, history, profile, reaction, file and metadata results/errors. Real HTTP tests cover success/401/500 and switching away/back to the same saved ID. Share retry/results and avatar upload/profile phases stay scoped. |
| High | Android Always Allow continued after a failed grant or switched computers between requests | One captured client performs grant and answer. Failed grants stop. Explicit button and automatic remembering share the same guarded operation. Existing no-memory semantics are retained. |
| High | iOS API, pairing and SSE automatically followed redirects outside the approved route | Refuse per-task redirects. Tests cover 301/302/303/307/308; an actual local HTTP fixture confirmed 307 never reaches the target. |
| High | iOS public descriptor received a bearer; identity was checked only during stream startup | Credential-free descriptor before every server-authenticated action and SSE connection. API requests disable ambient cookies; a real HTTP fixture reproduced a cookie on the public descriptor before this guard. Changed or unreadable identity fails closed. Public HTTP server routes are rejected; explicit local/LAN/tailnet remain. |
| High | Android voice keys used cleartext LAN and saved UI restoration state | Reject non-HTTPS key requests before transmission. Use transient UI state. Real TLS MockWebServer tests retain schema, validation and provider-refusal checks; HTTP emits zero requests. Sidecar config restrictions remain enforced. |
| High | Native file size checks happened after allocating the whole HTTP response | Bound reads during transport: 25 MiB files, 64 MiB other finite responses, 1 MiB iOS descriptor. Reject declared and unknown-length overflow; exact file limit succeeds. |
| High | Native SSE lines/events and the iOS consumer queue were unbounded | 8 MiB line/event limit. iOS buffers a finite oldest prefix and reconnects on overflow, retaining cursor replay instead of silently dropping intermediate frames. Android retains suspending bounded Flow delivery. |
| Medium | Failed iOS notification task switches opened the previous conversation | Propagate failures and verify the requested thread before publishing navigation. Bot/room 404/503, runtime replacement and gone thread-link tests. |
| Medium | Cached search unnecessarily fetched HTTP; stale cached heads hid newer server history | Focus only fully rendered cached hits. Snapshot the leaf before HTTP; adopt a server advance when unchanged, preserve SSE changes during the request. Keep page/byte/time bounds and gap/repeated-page tests on both platforms. |
| Medium | Late Android queued receipts survived empty authoritative snapshots | Snapshot revision rejects previously unseen stale receipts; state and real HTTP/SSE tests. |
| Medium | Call playback ignored denied audio focus; failed spoken sends stayed stuck | Refuse before engine allocation; release focus/owned playback; generation-scope callbacks. Resume listening only for a still-active originating call. |
| Medium | iOS preview retained audio interruption | Release on completion, failure, replacement and dismissal; reject stale preview data. |
| Medium | Channel aggregate unread selected the wrong task | Enumerate/project unread tasks on both platforms and retain exact-thread navigation. |
| Policy | Imported implementation/history narration violated AGENTS.md | Remove narration, preserve wire/security/platform facts and original notices. Comment-only subsets retain identical non-comment code/literal tokens. MODIFICATIONS.md records imported changes. |
| CI | Main Docker held-volume smoke expected the old product name | Match the actual StartupBot refusal, keep second-container rejection and live-container health checks. A regression checks the workflow/runtime contract; production lock behavior is unchanged. |

## Additional reviewed boundaries

- Pairing: one-time redemption, request IDs, device origin, route consent, HTTPS ratchet and approved LAN/Tailscale origins. Wire identifiers remain compatible.
- Credentials: Keystore/Keychain and backup exclusions, separate App Group identity, HPKE v1 domain separation, no signing secrets. Removing a phone connection is not claimed as host revocation.
- Cards/sends: structured questions, complete skill/reference/digest review, encrypted credential entry, draft preservation, idempotency and queue tombstones remain enabled. Cancellation is not a successful action.
- Packaging: owned artwork, app/data identities, complete per-architecture payload checks, lossless compression and internal-only artifacts. Upstream updater/release sources remain disabled.
- Licensing: pinned native Apache sources retain LICENSE/NOTICE/LICENSING and modification records. No Enterprise source is added. Historical Enterprise distribution/legal review remains a separate release gate.
- Workflows: full source CI, Android unit/emulator and iOS core/App/UI are distinct gates; no store upload, secret or paid service is added.

## Actual checkpoint evidence

Prior head 271fdc7fa: [Full CI 44292357681](https://github.com/tigerthong1102/MoonBot/actions/runs/44292357681) SUCCESS; [iOS ARM-hosted Simulator/device archive 44292711721](https://github.com/tigerthong1102/MoonBot/actions/runs/44292711721) SUCCESS. These do not qualify later functional changes.

Prior Android run 44292347992 FAIL: one cached-search Compose regression, 623 core and 978/979 app tests passed. The root cause is corrected without removing assertions or increasing timeouts.

Current working-source local results: 634 Android core tests PASS, 0 skipped; Swift core build/syntax PASS; root lint/typecheck/build PASS; Docker/runtime targeted tests 84 PASS and 2 platform-dependent SKIPPED; identity/artwork/attribution/HPKE checks PASS. Actual compiled Swift core against an isolated HTTP fixture passed redirect rejection, credential-free changed-server rejection and early oversized-body rejection.

The fix SHA requires fresh full CI/native acceptance. Local XCTest/Simulator is BLOCKED by missing full Xcode. Physical phones, live-provider desktop pairing/chat/permissions and store signing/submission are NOT RUN. No live owner data was used. A source merge decision is separate from commercial/store release readiness; synthetic tests cannot prove a perfect app.
