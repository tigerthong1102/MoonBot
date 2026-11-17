# Review audit — 2026-11-17

Reviewed PR head: `a9f9ce7e8642c986653a73bcd04b2de290879bd3`.
CI run [43981561567](https://github.com/tigerthong1102/MoonBot/actions/runs/43981561567): success, 34 successful jobs and 1 skipped. This evidence applies only to that head.

Qodo lists 16 bugs plus one rule insight. NEEDS INVESTIGATION is not a dismissal.

| # | Finding | Classification | Evidence / next step |
|---|---|---|---|
| 1 | Windows updates look in wrong repo (`electron-builder.yml`) | FALSE POSITIVE | Independent update source is intentional; updater is disabled. |
| 2 | Owner-level replies remain readable after key rotation (`server/bot-api-host.ts`) | CONFIRMED | GET lacked the owner-mode guard used by POST; guard added; host tests (21) and an isolated server fixture (1) passed. |
| 3 | Failed browser launches can occupy a slot (`server/browser-runtime.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 4 | An unused browser can still occupy a slot (`server/browser-runtime.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 5 | Queued work can cancel a restart retry (`server/runtime/runtime.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 6 | Every app launch reports an update failure (`electron/updater.mjs`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 7 | A person's browser can exceed process limits (`server/host/browser.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 8 | Unknown account state exposes old link ids (`electron/bot-link-main.mjs`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 9 | Large hosts get incomplete process reports (`server/perf/process-sampler.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 10 | Upstream report never shows merge conflicts (`.github/workflows/startupbot-upstream.yml`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 11 | Servers still point users at upstream releases (`electron/updater-config.mjs`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 12 | One file-staging call can exhaust server memory (`server/connector-files.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 13 | Process reports lose some engine counts (`server/perf/process-health.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 14 | Zombie warnings falsely blame missing init (`server/perf/process-health.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 15 | Phone swipes can end far off the screen (`server/drivers/phone-proxy.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 16 | A failed config restore crashes the cli (`server/config-backup.ts`) | NEEDS INVESTIGATION | Review finding requires behavioral verification; no resolution claimed. |
| 17 | Site support link points at another repo (`startupbot-site/site.js`) | FALSE POSITIVE | MoonBot is the current repository; the target StartupBot repository is not yet verified. |

Codex Review at `1d26b6866` has five unresolved, non-outdated threads: usage-cap design rule, descendant process lifetime, crash-guard comments, browser slot release and title-generation usage cap. All are NEEDS INVESTIGATION until verified and fixed. The browser close finding overlaps Qodo #4.

No review thread has been resolved. Re-run full CI and both reviews after fixes; release remains NO-GO.
