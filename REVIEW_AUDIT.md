# Review audit — 2026-11-17

Reviewed PR head: `a9f9ce7e8642c986653a73bcd04b2de290879bd3`.
Additional changes reviewed against `0c403c71f45d819888eb0a8a4671c257521fac54` are in the commits following that head; final CI must be checked on the resulting head.
CI run [43981561567](https://github.com/tigerthong1102/MoonBot/actions/runs/43981561567): success, 34 successful jobs and 1 skipped. This evidence applies only to that head.

Qodo lists 16 bugs plus one rule insight. NEEDS INVESTIGATION is not a dismissal.

| # | Finding | Classification | Evidence / next step |
|---|---|---|---|
| 1 | Windows updates look in wrong repo (`electron-builder.yml`) | FALSE POSITIVE | Independent update source is intentional; updater is disabled. |
| 2 | Owner-level replies remain readable after key rotation (`server/bot-api-host.ts`) | CONFIRMED | GET lacked the owner-mode guard used by POST; guard added; host tests (21) and an isolated server fixture (1) passed. |
| 3 | Failed browser launches can occupy a slot (`server/browser-runtime.ts`) | CONFIRMED | A newly admitted slot is released when launch preparation or client readiness fails; existing slots and a concurrent person's admission are retained. Browser room and runtime regression tests pass. Process-budget reservation cleanup needs separate verification. |
| 4 | An unused browser can still occupy a slot (`server/browser-runtime.ts`) | CONFIRMED | Successful close releases the reservation; browser runtime regression test passes. |
| 5 | Queued work can cancel a restart retry (`server/runtime/runtime.ts`) | CONFIRMED | Supersession now requires that the newer assignment actually started; runtime regression test covers queued and started cases. |
| 6 | Every app launch reports an update failure (`electron/updater.mjs`) | CONFIRMED | Disabled updater has an explicit idle/disabled state and Settings offers no check; UI regression test passes. |
| 7 | A person's browser can exceed process limits (`server/host/browser.ts`) | CONFIRMED | Human browser startup reserves its estimated process footprint before the first browser command. Process-budget and browser-live tests pass; a failed startup can conservatively hold the reservation for up to the existing 60-second startup window. |
| 8 | Unknown account state exposes old link ids (`electron/bot-link-main.mjs`) | CONFIRMED | Address lookup now requires matching known account IDs; Electron regression test passes. Legacy account-less links cannot expose addresses until paired with a known account. |
| 9 | Large hosts get incomplete process reports (`server/perf/process-sampler.ts`) | CONFIRMED — PARTIAL | A capped list marks the process report and process-health count as incomplete and includes the server PID when available. A regression test checks that the warning also persists while an affected CPU interval remains in the one-hour history. Missing ancestor handling remains to be verified before closing. |
| 10 | Upstream report never shows merge conflicts (`.github/workflows/startupbot-upstream.yml`) | CONFIRMED | Uses the modern merge-tree conflict report; a temporary Git repository with conflicting edits reported the affected path and conflict. |
| 11 | Servers still point users at upstream releases (`electron/updater-config.mjs`) | CONFIRMED | Live server update routes now return disabled without an upstream request or update command and do not create the server updater; unit test and isolated server fixture pass. The unused upstream checker remains in the tree and must not be wired back without independent release qualification. |
| 12 | One file-staging call can exhaust server memory (`server/connector-files.ts`) | CONFIRMED | A request now has a cumulative file-size budget and reads through a bounded handle; connector file tests pass. Concurrent requests still require separate memory-pressure evaluation. |
| 13 | Process reports lose some engine counts (`server/perf/process-health.ts`) | CONFIRMED | Extra fixed engine kinds are counted in a bounded other bucket; regression test verifies the total. |
| 14 | Zombie warnings falsely blame missing init (`server/perf/process-health.ts`) | CONFIRMED | Warning reports observed zombies without asserting an unverified cause; process-health tests pass. |
| 15 | Phone swipes can end far off the screen (`server/drivers/phone-proxy.ts`) | CONFIRMED | The computed endpoint is checked before the input command; phone proxy regression test passes. This is the advertised 0–10000 bound, not a physical-device acceptance test. |
| 16 | A failed config restore crashes the cli (`server/config-backup.ts`) | CONFIRMED | Atomic-write failure returns a structured error; a regression test injects the failure after preserving the current settings. |
| 17 | Site support link points at another repo (`startupbot-site/site.js`) | FALSE POSITIVE | MoonBot is the current repository; the target StartupBot repository is not yet verified. |

Codex Review at `1d26b6866`: browser close overlaps Qodo #4; the group execution timeout has a descendant-outlives-leader regression test; the retrospective crash-guard header was removed. DESIGN.md now gives a narrow exception for owner-set spending caps. Title generation checks the relevant budget again after a queued job obtains a slot, including direct, group, manual and call titles; the queued-slot unit test passes. Full end-to-end cap verification and current-head review are still required.

Four Codex threads (design exception, process-group timeout, crash-guard comment and browser close) have been replied to and resolved. The title-cap thread remains open pending end-to-end verification. Re-run full CI and both reviews after fixes; release remains NO-GO.

## Follow-up review on later commits

| Finding | Classification | Evidence / remaining work |
| --- | --- | --- |
| Timed-out group ID can be reused before delayed SIGKILL | NEEDS INVESTIGATION | The delayed numeric group ID has no verified lifetime token. Do not consider the process timeout fully resolved until termination is redesigned and tested without signalling unrelated processes. |
| Reopened browser loses stale startup reservation | CONFIRMED | Renew an expired reservation when its browser has stopped; regression exercises the second startup before process counts catch up. |
| Long preview repeatedly copies the entire prefix | CONFIRMED | Inspect only the last two UTF-16 units, preserving supplementary code point handling; preview tests pass. |
| Thread-map header records implementation history | CONFIRMED | Removed the retrospective comment. |
| Urgent background job transfers overflow to an ordinary waiter | CONFIRMED | Retire the completed slot before admitting a queued job, with a regression for limit one and an urgent overflow. |

The three focused suites for the browser reservation, job slots, and preview passed 61 tests locally. Final-head CI and end-to-end review remain outstanding.

## CI and Codex follow-up against 3acbf38f9303427c26bfae8c8a1af4fa509356fd

Run 44009054591 completed with failures. The authentication cascades traced to test fixtures writing `.openmausbot` while StartupBot reads `.startupbot`; production authorization was retained. Other confirmed failures were the updater VM missing the disabled cloud transport, stale product text, server/catalog text disagreement, and a locale-switching test lacking unconditional cleanup.

Latest Codex findings: connector header history removed; confirmed browser shutdown now releases process-budget reservations; emitted thread links use StartupBot with legacy parsing retained; subprocess retained output is bounded after overflow; connector permissions are checked again after attachment upload. Focused regression results: 87 resource/link/process tests, 25 trust-control tests including revocation during upload, and 444 contract/updater/UI/ratchet tests passed locally. Build and lint passed. Full failing-file rerun and final-head CI remain required.

The delayed numeric process-group SIGKILL finding remains open; no claim of full termination safety is made. Updater source and current repository support URL remain intentional; neither was changed back to upstream.

## Codex verification on 2026-11-17 (baseline e031d8baef72dceaf0d90f9af8c6641f1748a144)

The latest remote changes were fast-forwarded without rewriting history. Confirmed fixes: Linux descriptor consumer uses the StartupBot bundle identity; routine restart recovery propagates continuesRun through usage-cap checks; connector permissions are checked during upload and before dispatch; closed child processes cancel delayed group kills; UI selection uses accent-ink; retrospective helper headers were removed.

Local review regression: 430 passed, 2 platform skips across ten suites (title generation and regeneration, browser runtime/live, process budget, thread links, process groups, connector files, local computer and routine recovery). Remaining OAuth, secret-card, MCP-expiry and fill-login wording tests: 229 passed across six suites after aligning the stale assertions and two production messages with StartupBot. Lint and typecheck passed before the final text-only edits. These results do not imply final-head GitHub CI passed.

The previous broad rerun had 1357 passed and 11 failed, including two runtime investigations (secret-request spawn readiness and room image steering). Those two have not been dismissed as flaky or qualified by the narrower passing review tests. Full CI, package smoke and fresh final-head reviews remain merge gates.

## Codex follow-up from ac7baf1042

- CONFIRMED: removed the cross-file implementation overview from electron/bot-link-address.mjs; the address helpers and consistency test remain.
- CONFIRMED: provisional process-budget admission provides an ownership-checked rollback to BrowserRoom. A failed preparation releases only its own reservation; existing reservations and a concurrently confirmed browser remain held.
- CONFIRMED: each scoped driver execution has an identity, checked against both the latest dispatch and the watchdog's watched execution before crash recovery can stop a turn. A late callback from a completed or superseded execution follows the fatal policy without failing the newer turn. Regression tests cover same-engine and switched-engine reuse, completion, and the gap before a replacement driver dispatch.

Focused validation: 356 passed, one platform skip across crash guard, watchdog, browser room/runtime/live, process room and linked-address suites. This is local evidence; final-head CI remains required.

## CI fixture follow-up

The secret-request Cloud fixture now supplies OMB_DATA_DIR explicitly, matching its generated StartupBot config instead of the Cloud launcher's default directory. Its original secret-redaction and one-use assertions remain. The room image-steer test now waits for the engine's actual Bash tool chip, not an unrelated activity such as resource admission waiting; steering, image, queue and timeout assertions remain. Running both complete files together passed all 25 tests. Qodo review is excluded from subsequent work at the owner's request.

The completed older full CI run 44021257214 also exposed stale desktop-computer wording contracts. The plain readiness helper now returns the same coded-error message as the dispatch gate; the shared readiness prefix and exact assertions follow StartupBot. Focused follow-up: 134 desktop/local-VM/UI tests passed; VPS/Codex driver suites passed 369 tests with one platform skip. No desktop authorization check was relaxed. Final-head CI is still required.

## Codex process-group escalation follow-up

CONFIRMED: a command leader can close while a TERM-resistant descendant with independent stdio remains. POSIX execFileInGroup commands now run under a supervisor in their own group. Cancellation is delivered to that live supervisor, which retains its group membership through the grace period and escalates by signalling its own group. Escalation therefore does not depend on the command leader's stream closure or a delayed signal to a saved, potentially reused group ID. The supervised command retains stdout/stderr, exit-code and spawn-error contracts; Windows keeps its taskkill path. The additional supervisor is one process per POSIX command.

Regression includes an independently piped descendant ignoring TERM, early leader exit with inherited output, maxBuffer overflow, normal output/exit and ENOENT. Git checkpoint/container/usage-cap consumer checks passed 167 tests with one platform skip; lint, typecheck and server bundle build passed locally. The internal usage-cap header overview was removed. Final-head GitHub CI and fresh Codex review remain pending.

## Codex follow-up through e92e045ca

All four findings from 9e068adaea are confirmed. The AppArmor executable attachment uses the exact /opt/StartupBot browser path; its policy now has an independent startupbot-browser namespace in the package resource and install/remove hooks, preventing changes to a coinstalled upstream profile. A Linux-only regression verifies both install and removal preserve the upstream policy. The usage-cap gate overview was removed. Monetary caps accept unambiguous decimal-comma cents and reject mixed or ambiguous separators; token grouping requires complete groups of three. Native event-loop histograms retain cumulative sample ranks, including the 96 normal / 4 delayed sample regression across minute rolls. The histogram injection contract accepts recordable histograms without unsafe casts.

The two newer Codex findings are also confirmed: the stall-monitor history header was removed, and model-call accounting takes precedence over tool counts, which remain the fallback for engines without usage events. Regressions cover identified and anonymous usage with batched tools and preserve no-usage fallback, denial and duration limits. No upstream updater, Enterprise source or release workflow was enabled.

Validation after integrating e92e045ca: five targeted suites passed 29 tests with 32 platform skips on macOS, including file-size guards. Before integration, six suites including isolated unattended-turn E2E passed 36 tests with 32 platform skips. Linux privileged hook execution and restricted-host sandbox acceptance still require Linux CI; the local Docker daemon is unavailable. Final-head GitHub CI and fresh Codex review remain gates.

## Concurrent Cloud fixture isolation

Run 44027176671 (9e068adaea) failed one-home-session.e2e.test.ts while minting a signed pairing code with invalid_signature. The port picker releases its probe sockets before subprocess startup and does not claim the selected block: a deterministic reproduction with the same random choice returns the same unbound block twice. Two fixture launches in Promise.all can therefore accept another fixture's health response before their own child binds and then sign with the wrong fixture secret. Startup is now sequential, with an assertion that all four server URLs differ. The actual concurrent moves, retries, crashes, session limits and sign-out assertions remain unchanged. Both isolated fixture/source-guard suites passed (2 tests); the combined session/Claude elicitation rerun previously passed 19 tests. No authentication policy was relaxed. A current-head full CI result is still required.

## Packaged branding and CI selection follow-up

Legacy packaged PNG, ICNS, ICO and SVG entry points now use the supplied StartupBot logo. README no longer advertises upstream installers or uses the upstream hero as StartupBot's banner. Branding/CI guards passed 67 tests; the three Electron icon consumer suites passed 52 tests. BRANDING_AUDIT.md records the remaining avatar, localized-copy, documentation and rights gaps; full branding clearance is not claimed.

Current-head full CI 44032258748 failed preflight on c03b8f51c: the new branding test reads README but was missing from the documentation-only CI subset. The subset now includes that test, preserving the existing exact-reader coverage assertion. All five preflight/branding suites passed locally (256 tests). This fixes CI selection rather than suppressing a test. The previous completed full run 44027176671 had five failing jobs: three platform shards shared stale Claude elicitation wording, the Linux package smoke used the old install root, and the Cloud session fixture had overlapping startup probes. Those fixes are present; final-head CI must still verify them.

## Native histogram boundary regressions

The histogram finding also reproduced on small populations: with ten 20 ms samples and one 2 s sample, Node's native p95 uses rank 10, while a ceil-based cumulative quantile selected the stall. Threshold counts also lost near-boundary samples when delays were rounded before counting. Four regression cases failed before the correction. Snapshots now retain unrounded delays; cumulative counts use integer ranks, requested percentiles use the native nearest-rank convention, and milliseconds are rounded only for display. Regressions cover 1/3/11/21/101 samples, merged minutes, and delays just over 100 ms and 1 s. All six performance suites passed (61 tests); lint and typecheck passed. Current-head GitHub CI remains the gate.

## Codex and CI follow-up from 5652232a0

Both findings from 3ce0e10245 are confirmed. The engine-record overview was removed in 5652232a0. Chrome browser closure now releases process reservations through service lifecycle callbacks. This follow-up also reserves on each actual new start, limits failed-start cleanup to the same profile/epoch with no running browser, and reports closure only after a successful close or observed exit. It preserves reservations for unconfirmed closure and prevents a canceled old startup from releasing a replacement browser's budget. Removing the epoch/profile guard makes the replacement-start regression fail; the guarded Chrome/process/source suites pass 167 tests. Tests cover tool close, unused close, all-close, idle sweep, crash, startup failure, reopen, caller failure and stale replacement startup. Engine-record regressions pass 11 tests.

The owner's run 44036029216 targets 5652232a0. Its package smoke failed because run-linux-package-smoke.mjs still selected /opt/OpenMausBot/openmausbot; all active package-smoke consumers and the macOS afterPack fallback now match StartupBot's installed roots, checked against electron-builder metadata. Its Ubuntu browser S4 failure assumed the forward entry must remain in BFCache. Chrome can evict that cache (https://web.dev/articles/bfcache); the test now checks exact load counts against pageshow.persisted, retains fragment/history/reload assertions, and has an explicit cached-document lifecycle regression. All three relevant real-Chrome files pass on the local Mac (44 tests); latency thresholds are unchanged.

Two additional failed shards in that run share the stale Sentinel installed-app fixture, now corrected without reverting production discovery paths. The older full run 44033575068 also had an Electron binary download failure before tests and a macOS click benchmark exceeding its unchanged limit by 2 ms; the latter passes locally unchanged and still requires final-head CI. A POSIX checkpoint GC test exceeded 20 seconds with the per-command supervisor: an isolated pinned-GC measurement took 16.66 seconds locally, and the other full GC scenario reproduced the timeout. Only the two 25-snapshot GC tests now use a bounded 60-second deadline; all collection, pin, user-data and cancellation assertions remain. Checkpoint/process/service regressions pass 49 tests with one platform skip.

Local batch preflight/branding/package guards pass 268 tests. Lint, typecheck and application build pass. Source merge readiness remains conditional on the final-head GitHub checks and fresh Codex review; branding/asset rights and distribution gates remain separate.

## Codex follow-up from 9f8479888a and d5ffbc70d

All three findings from 9f8479888a are CONFIRMED. The integrated d5ffbc70d fix carries linked-room user/outside origin and grants the direct MCP child its own bounded shutdown grace. This follow-up passes the originating assignment into admission so acting-person attribution is retained, treats unknown origin as unattended, and verifies actual reached-cap enforcement with no active routine. Three usage-cap regressions failed before the patch. Real linked-room replies preserve user/outside origin, and outside/unknown follow-ups cannot start after the unattended cap is reached.

MCP regressions cover direct SIGTERM and SIGINT shutdown, a parent flushing after its descendant exits, and a TERM-resistant tree. The three new flush tests failed before the fix; all integrated MCP/config/linked-room/cap suites pass (110 tests). Shutdown retains the 1.5-second escalation bound and process-tree identity checks. The process-budget overview and other newly added cross-file implementation headers were removed while retaining OS, privacy, billing and isolation facts. Generated settings metadata was regenerated from its source. Acting-person and isolated one-on-one goal tests pass (28 tests). Lint, typecheck, application build and packaged-server smoke pass after integration.

Full run 44038741509 on 9f8479888a confirms the Linux installed-package smoke and browser S4 checks on Linux, Windows and macOS pass. It also exposed Windows shard 6/8 failing only during Antigravity sign-out test teardown: immediate rmSync(profile) raised EPERM after sign-out/token/account assertions completed. Fixture profile deletion now uses bounded filesystem retries and still throws on failure, with explicit absence checks. It does not use the best-effort cleanup helper or weaken authentication assertions. The complete Antigravity suite passes locally (72 tests); policy/process/settings regressions pass 63 tests and CI-scope/documentation guards pass 192. Final-head Windows CI must verify this platform-specific fix. No failed test was disabled, no updater was enabled, and Qodo remains excluded at the owner's request.
