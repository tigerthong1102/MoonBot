# Review audit — 2026-11-17

Reviewed PR head: `a9f9ce7e8642c986653a73bcd04b2de290879bd3`.
Additional changes reviewed against `0c403c71f45d819888eb0a8a4671c257521fac54` are in the commits following that head; final CI must be checked on the resulting head.
CI run [43981561567](https://github.com/tigerthong1102/MoonBot/actions/runs/43981561567): success, 34 successful jobs and 1 skipped. This evidence applies only to that head.

Qodo lists 16 bugs plus one rule insight. NEEDS INVESTIGATION is not a dismissal.

| # | Finding | Classification | Evidence / next step |
|---|---|---|---|
| 1 | Windows updates look in wrong repo (`electron-builder.yml`) | FALSE POSITIVE | Independent update source is intentional; updater is disabled. |
| 2 | Owner-level replies remain readable after key rotation (`server/bot-api-host.ts`) | CONFIRMED | GET lacked the owner-mode guard used by POST; guard added; host tests (21) and an isolated server fixture (1) passed. |
| 3 | Failed browser launches can occupy a slot (`server/browser-runtime.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 4 | An unused browser can still occupy a slot (`server/browser-runtime.ts`) | CONFIRMED | Successful close releases the reservation; browser runtime regression test passes. |
| 5 | Queued work can cancel a restart retry (`server/runtime/runtime.ts`) | CONFIRMED | Supersession now requires that the newer assignment actually started; runtime regression test covers queued and started cases. |
| 6 | Every app launch reports an update failure (`electron/updater.mjs`) | CONFIRMED | Disabled updater has an explicit idle/disabled state and Settings offers no check; UI regression test passes. |
| 7 | A person's browser can exceed process limits (`server/host/browser.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 8 | Unknown account state exposes old link ids (`electron/bot-link-main.mjs`) | CONFIRMED | Address lookup now requires matching known account IDs; Electron regression test passes. Legacy account-less links cannot expose addresses until paired with a known account. |
| 9 | Large hosts get incomplete process reports (`server/perf/process-sampler.ts`) | CONFIRMED — PARTIAL | A capped list now marks the process report and process-health count as incomplete and includes the server PID when available; focused tests pass. Verify ancestor handling and historical samples before closing. |
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
