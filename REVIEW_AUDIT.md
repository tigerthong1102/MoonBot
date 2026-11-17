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
