# Release readiness

## Latest PR #1 validation

The reviewed head `522da6b64927b06a5ba7df5569845626913e0025` fixes the connector-helper comment finding and makes the descendant fixture wait for its PID before aborting. Its [CI run 44083246218](https://github.com/tigerthong1102/MoonBot/actions/runs/44083246218) failed the Linux container S4 resize regression; Docker, connector, docs and website passed on that SHA. The earlier [23542a6db CI](https://github.com/tigerthong1102/MoonBot/actions/runs/44080404476) was canceled with a real Ubuntu shard 7/8 fixture failure and is not a green baseline.

The follow-up removes the confirmed backup-allocation narration and equivalent private-helper overviews, preserving complete comment-free TypeScript syntax, declarations and embedded program strings in 87 source files. It also waits across two renderer animation frames after clearing device metrics: Chrome 157.0.8103.78 can still report the emulated size in the first frame, causing window fitting to calculate invalid bounds. The unchanged size/frame assertions now run 32 resize cycles. Local evidence: the old implementation failed on that exact Chrome version with `[1280,1400,2]`; the fix passed 240 diagnostic cycles and all 102 native S4 tests. The four backup/viewer/process/connector suites pass 87 tests. Local validation also passes all 12 stream tests on Chrome 156.0.8078.80, 258 backup/connector/cap/verification/CI-scope/size tests, lint, typecheck, production build and packaged-server smoke. Required checks and a completed clean Codex review must still validate the pushed follow-up SHA. No manual full matrix is dispatched and no passed job is manually rerun.

| Target | Decision | Evidence / blocker |
| --- | --- | --- |
| Windows installer | NO-GO | Clean-machine install, product identity, separate data directory, signing and updater not qualified. |
| macOS Apple Silicon / Intel | NO-GO | Unsigned local experimental DMGs were produced from a changing, uncommitted tree, so they cannot be traced to a commit. Clean-machine launch, agent, Computer Use, separate-data and permission acceptance, signing and notarization remain unverified. |
| Linux | NO-GO | Ubuntu 24.04 installed-package smoke passed on 021673f3f; asset rights, signing/updater qualification and acceptance on other distributions remain open. |
| iOS | NO-GO | Upstream release-branch source found; dependency/asset review incomplete; no simulator build, signing or TestFlight artifact. |
| Android | NO-GO | Upstream release-branch source found; dependency/asset review incomplete; no Android SDK build, APK, AAB or emulator evidence. |
| Website | NO-GO | Local bilingual preview only; visual QA, verified downloads, deployment and approved privacy/terms remain outstanding. |
| Phone protocol | NOT QUALIFIED | Isolated protocol tests do not establish the four cross-device combinations. |

Release and updater remain disabled. A future pipeline must build on isolated
runners, verify checksums and provenance, sign with least-privilege credentials,
produce a reviewable draft and require human approval before publishing. No
upstream secrets or release endpoints may be reused. The owner must provide or
approve an independent repository, signing identities, developer accounts,
service ownership, legal review and real-device access. Never put credentials
in Git. Do not change DNS, deploy paid services or publish as part of this audit.

## CI evidence

On `0c403c71f45d819888eb0a8a4671c257521fac54`, [Docker](https://github.com/tigerthong1102/MoonBot/actions/runs/43987313053), [website](https://github.com/tigerthong1102/MoonBot/actions/runs/43987313110), [docs](https://github.com/tigerthong1102/MoonBot/actions/runs/43987313407) and [connector E2E](https://github.com/tigerthong1102/MoonBot/actions/runs/43987313080) passed. A later [full CI run](https://github.com/tigerthong1102/MoonBot/actions/runs/44005134073) targets `f2a9856694ce057c027a3fdff173b951c74874d1`; its final result must be checked independently. Subsequent branding changes require a new run. The local Apple Silicon machine built experimental arm64 and x64 DMGs using Command Line Tools without full Xcode; those files predate later working-tree changes and are not release artifacts.

[Run 43981561567](https://github.com/tigerthong1102/MoonBot/actions/runs/43981561567) passed on `a9f9ce7e8642c986653a73bcd04b2de290879bd3`: 34 jobs passed and one was skipped. Later commits need their own CI. This is not installer or release qualification.

## Current review follow-up

The reviewed baseline advanced to e92e045ca without rewriting history. Codex fixes cover Linux sandbox attachment, independent AppArmor policy ownership, spending-cap input validation, accurate event-loop stall accounting and unattended model-request limits. Targeted local regressions pass; Linux hook execution is platform-skipped on this Mac and the local Docker daemon is unavailable. Full CI must be checked on the resulting pushed SHA. Historical green runs above do not qualify the current HEAD. PR #1 remains ready for human review at the owner's request; this does not assert merge or release readiness. No installer was built or release published in this task.

## Review and CI follow-up from 5652232a0

The latest reviewed tree includes independent icons and AppArmor policy ownership, native histogram boundary fixes, Sentinel discovery and Chrome reservation cleanup. Run 44036029216 failed the installed Linux executable path, browser-history BFCache assumption and stale Sentinel fixture. These have focused patches and local regression evidence in REVIEW_AUDIT.md; a new full CI on the pushed result is required. The older 44033575068 run also had dependency-download, timing and checkpoint-deadline failures and must not be called green. BRANDING_AUDIT.md explicitly records that locale copy, avatars, documentation and rights clearance are incomplete. No commercial release or platform-install qualification is asserted.

## Latest Codex and CI verification

Baseline 9f8479888a and integrated d5ffbc70d preserve independent update ownership and the disabled release gate. Linked-room cap provenance and MCP shutdown data-flush regressions are fixed and tested locally; REVIEW_AUDIT.md records the red/green evidence. Full run [44038741509](https://github.com/tigerthong1102/MoonBot/actions/runs/44038741509) passes the formerly failing native package/browser smoke checks but has a Windows Antigravity teardown failure. Its historical results do not qualify a later HEAD. The bounded teardown correction requires a new exact-head full CI and Codex review. PR #1 is ready for review, with source merge readiness pending those checks. Branding/legal and commercial distribution gates remain open. No installer or release was produced in this task.

The completed full run 44038741509 failed Windows Antigravity teardown and two macOS USB phone fixture waits (plus its aggregate CI check). The fixes have local regression evidence, but need current-head platform verification. PR-scoped 44042768756 also exposes a key-rejection wait-status mismatch. A local reproduction confirms an automatic retry can append a user line after the job snapshot; the client now retains that job's explicit failed-root outcome. Deterministic red/green regressions and isolated key-rejection tests pass, with final-head CI still required. Latest Codex comment-policy feedback is addressed; a fresh review is required after pushing. READY TO MERGE remains NO while any of these exact-head verification gates are open.

The later Windows linked-work fixture failure in 44042772453 is covered by isolated coordinator-clock assertions and an online-expiry control (43 linked-room tests pass). The exact-head full run must verify all three operating systems again. An in-progress or superseded run is never counted as green.

## Current watcher evidence

PR CI [44054962288](https://github.com/tigerthong1102/MoonBot/actions/runs/44054962288) passed on f32c4e15a6a07b2bd77986ef0a24463c4790d4d6 (34 passed, one deployment skipped). Its [Docker run](https://github.com/tigerthong1102/MoonBot/actions/runs/44054962327) also passed. These are historical exact-SHA results, not qualification of subsequent changes or the full platform matrix.

Full manual [44047858901](https://github.com/tigerthong1102/MoonBot/actions/runs/44047858901) on 8137b46a7 failed macOS browser S4, Ubuntu shards 1/5/8 and Windows shard 6, plus the aggregate check. REVIEW_AUDIT.md records each inspected cause and correction: real Chrome 156 resize/capture synchronization, legacy partial-result MCP compatibility, authorized personal-secret precedence and bounded durable-write fixture batching. The latest Codex findings concern reservation ownership and ACP comment policy; focused fixes preserve startup protection and add per-session task accounting and cache-identity regressions.

Local verification passes 113 MCP/auth/recovery/delta tests, 266 browser/resource/vault/Chief tests, all 12 real Chrome 156 stream tests, lint, typecheck, application build and packaged-server smoke. Final-head full CI and a completed clean Codex review remain required. READY TO MERGE: NO until those gates pass. PR #1 remains Ready for Review at the owner's request. Commercial distribution remains NO-GO while the existing platform, branding/asset-rights and inherited-history license gates are open. Updates and publishing remain disabled; no installer, release or deployment was produced in this task.

On 144be627d the full local real-browser S4 batch passes 102 tests; GitHub Docker, connector, docs and website pass. Codex's completed review still found one test-comment policy violation. The follow-up removes that comment and equivalent process-fixture narration; all 97 affected-suite tests pass with assertions unchanged. The unfinished full matrix and PR CI on 144be627d must not be reported as PASS or used to qualify a later head.

Codex then completed review of 36c68a020 with one restart-overview comment violation. The correction and equivalent comment cleanup have identical executable output across 17 production files; all 150 runtime/recovery/restart/engine-record/size tests, lint and typecheck pass. No functional contract changes. Final-head full CI and a completed clean review remain pending; source merge and commercial release gates remain distinct.

The next completed Codex review, on 806621762, found an inline Store comment with a cross-file overview. Both matching inline comments are removed with identical Store executable output; all 240 Store/link/backup-policy/size tests and lint pass. macOS S4 and Docker/connector/docs/website passed on that SHA. A later head requires its own completed CI and clean review; readiness remains pending those results.

The latest review, on 3f9676095, reports redundant config-help branch comments. The batched comment-only correction has identical executable output across 28 files; 329 focused tests, four isolated parser assertions, lint and typecheck pass. The owner requested no full-CI restart: retain full 44065206581 on 3f9676095 and do not dispatch a replacement for this comment-only batch. Its actual SHA must remain explicit. Current-head automatic PR checks and completed clean Codex review remain merge gates. No test is skipped or disabled to implement this request.

The completed f3a3614a1 review found a functional pairing URL mismatch and private-cache narration. PairPage now emits startupbot://pair; adapter/parser round-trip and public-HTTP refusal are covered without changing the legacy wire protocol. The cache comment correction changes no algorithm. All 44 focused Vitest tests, 15 Node identity/parser tests, lint, typecheck and build pass. The retained full run on 3f9676095 predates this pairing-link fix; it is not final-head evidence for that behavior. No new full matrix is dispatched at the owner's request. Evaluate the current-head automatic CI, targeted regression and completed Codex review before merging; release qualification remains separate.

Retained full 44065206581 has a confirmed Windows shard 7/8 failure in the relay retry fixture; it must not be reported as green. A controlled slow loopback relay reproduces the combined-clock deadline problem. The correction isolates backoff time from real HTTP IO, preserving three refusals, logs, increasing retry gaps, authentication and the production timer. All 83 relevant tests and 193 guards, lint and typecheck pass locally. Codex's completed 14f731d46 review also reports a backup-sort overview; remove its narration without changing ordering or tests. The fixes share one commit and no new full matrix is dispatched. Current-head Windows PR CI and clean Codex review are still required before merge readiness can be asserted.

CI [44071162348](https://github.com/tigerthong1102/MoonBot/actions/runs/44071162348) completed SUCCESS on fdd466f6c7f8c8c031384a459f42b1c8f809f219 (34 passed, zero failed, one deployment skipped), including Windows shard 7/8. Docker, connector, docs and website also pass on that exact SHA. The older full run's failure/cancellations remain recorded separately.

The final batched review correction removes runtime budget-test narration and equivalent internal overviews, with identical executable output across all 93 changed source/test files. All 323 focused/guard tests, lint and typecheck pass. The owner explicitly chose a final batched push with required checks on the final SHA; skip-ci is not used and no additional full matrix is dispatched. Final-head automatic CI and completed clean Codex review are still pending at this checkpoint. Source merge readiness remains distinct from commercial distribution permission.

CI [44076359973](https://github.com/tigerthong1102/MoonBot/actions/runs/44076359973) completed SUCCESS on 021673f3f770fbce10dc48853b178c65e19a2f98 (34 passed, zero failed, one deployment skipped); Docker, connector, docs and website also pass. Codex then found a remaining mixed engine-fact/private-counter overview. The follow-up retains only external facts or configuration/data-safety contracts, with identical executable output across 11 source files. All 97 focused tests, lint and typecheck pass. Existing CI was allowed to finish before this next batched push; passed jobs are not manually rerun and no full matrix is dispatched. The new head still needs its own required checks and completed clean Codex review.
