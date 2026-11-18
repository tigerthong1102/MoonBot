# StartupBot native mobile — internal testing

Native source is kept separately from desktop delivery. Android is imported
from OpenMausBot commit `16ad4080f20fcd2fb310e27d527ce0f6a36e3724` and iOS from
`37a9d185d825641750b865114497c0ddab43e6dd`. Their root Apache-2.0 LICENSE,
NOTICE and LICENSING.md are retained beside each module and in app resources.
The Enterprise tree, upstream binaries, store screenshots and restricted
launcher artwork are not imported. Product labels, install identifiers and
launcher/default avatar artwork are modified for StartupBot.

## Build gates and actual status

Android target: `ai.startupbot.android`, Android 8.0 or later. The internal APK
uses the runner's debug signature. It is a test install, not a stable update
channel: a subsequent runner may use a different debug certificate and require
uninstalling that test app first. Export or preserve data before uninstalling.
The AAB is unsigned, not installable directly and not Play-ready without the
owner's signing configuration. Never commit a keystore or store password.

The Android pipeline runs core/app unit tests, builds APK/AAB, installs the APK
in a clean emulator, launches the real activity, checks process and onboarding
branding, and captures UI/log evidence. Pairing on a physical Android device
and a complete real desktop-mobile conversation are separate acceptance gates.

The iOS target is `ai.startupbot.ios`, iOS 17 or later, with separate App Group
and Keychain access groups. The compact simulator downloads are separate arm64 and x86_64 bundles.
Choose arm64 on Apple Silicon, x86_64 on an Intel Mac. Each keeps the full
application, share extension and widget for that architecture. It cannot be installed on an iPhone, used as an IPA, or
uploaded to TestFlight. Install Xcode and an iOS runtime on the Mac, boot its
Simulator, unzip StartupBot.app and drag it into the Simulator window.

The iOS pipeline runs protocol/core tests, compiles the app and extensions,
installs and launches it in Simulator, runs the native navigation fixture, and
captures a screenshot. Those synthetic navigation tests do not prove pairing,
remote chat, reconnect or approval against a real desktop. Signing, device
provisioning, TestFlight and App Store submission are outside this simulator
handover. The local Mac has Command Line Tools but no Xcode/XCTest: core build
passes; local XCTest/simulator execution is blocked by the missing developer
components. CI results, COMMIT.txt and SHA256SUMS.txt identify actual artifacts.

## Connect to a desktop

Use Phone & devices in StartupBot Desktop to authorize and pair the device.
The host must be on, awake, reachable and running StartupBot. LAN, an authorized
Tailscale route, HTTPS and an explicitly configured authorized relay remain
protocol options. No upstream relay or Cloud account is supplied by this build.
Mobile does not turn an offline desktop into a cloud agent.

The health identity, Bonjour service, old pairing decoder and HPKE v1 domain
separator remain wire-compatible. StartupBot owns the registered deep-link
scheme and install identity. The client must not bypass device scope, expiry,
revocation, authentication, TLS or E2E validation. Revoking host access is done
in the desktop's paired-device list; deleting a saved phone connection alone
does not revoke that host authorization.

## Third-party and privacy gates

Android uses Kotlin/AndroidX/CameraX/OkHttp/coroutines/serialization under their
respective licenses; iOS core has no external Swift package dependency. The
bundled QR scanner uses Google ML Kit barcode-scanning 17.3.0 under
[ML Kit terms](https://developers.google.com/ml-kit/terms), not Apache-2.0.
Google documents on-device image processing and possible service metrics and
model/compatibility communication. That must be reflected in privacy and
store disclosures; this is not a claim of a fully offline Android SDK stack.
No Google Cloud API key or paid service is provisioned.

Native interface translation coverage is inherited and incomplete; desktop's
16-catalog validation is not native-mobile localization certification. The
owner-supplied robot's commercial rights and historical Enterprise distribution
obligations remain separate release gates. Internal build success does not
clear commercial release, app-store distribution or the whole feature matrix.

The simulator handover uses Xcode's ad-hoc Simulator signing without an Apple
Development certificate. iOS capability claims are verified in the simulated
Mach-O entitlements, not injected into the restricted macOS host signature.
A Simulator-only canary writes, reads and deletes one synthetic Keychain item
and one temporary App Group file; missing privileges fail the artifact gate.
It does not use plaintext credential storage or touch desktop data.

## Historical qualified artifacts — 2026-11-18

These results qualify only the source SHA named below. The later review found
functional issues fixed in the 0.1.2 candidate; these older artifacts do not
qualify that candidate. Prefer a newer successful internal artifact only after
checking its COMMIT.txt, smoke evidence and SHA256SUMS.txt.

Android [44215532499](https://github.com/tigerthong1102/MoonBot/actions/runs/44215532499)
PASS at `5ac456cff0ff9027b9bc8ad76731b0ecadfb53a5`: core/app tests, APK/AAB,
clean emulator installation, real launch and StartupBot onboarding/logo checks.
The [actual artifact](https://github.com/tigerthong1102/MoonBot/actions/runs/44215532499/artifacts/14387623543)
contains the debug-signed APK, unsigned AAB, smoke evidence and checksums.
The APK SHA256 is `f059e292164c96ea2fd1e853363204e3b7f2ae245c514234a921c6a1166da666`.
The AAB SHA256 is `96453571df8110909077b84c9d3b4fd9ac9d9d6624a9c1ec6aa54314f1ce4c21`.

iOS Simulator [44220727356](https://github.com/tigerthong1102/MoonBot/actions/runs/44220727356)
PASS at `292e014dd9bebeb29d18ad21c15ba5128a015213`: 402 core tests,
universal arm64/x86_64 app compilation and entitlement verification, installation
and launch on ARM Simulator, actual Keychain/App Group canary and five native
navigation tests. The [actual artifact](https://github.com/tigerthong1102/MoonBot/actions/runs/44220727356/artifacts/14391711034)
contains `StartupBot-0.1.0-SIMULATOR.zip`; its SHA256 is
`b6b9795d64878ad9dd4872e0d9fc75b7a276401e7cb9c8ec382a18f1678a2bc1`.
Download checksums, smoke/security reports and the StartupBot screenshot were
inspected. Unzip the app and drag it into an already booted Xcode Simulator.
Intel Simulator runtime, physical iPhone and TestFlight are NOT RUN.

Physical pairing, live model/chat and real desktop-mobile approvals remain
NOT RUN for both native platforms. Desktop source/test follow-ups do not modify
the qualified APK or Simulator app. These are internal acceptance results,
not general release or commercial clearance.

## Earlier diagnostic failures

The first Android emulator setup tried to re-fetch an unavailable compile SDK;
the fixed lane requests only its runtime/system image and subsequently passes.
Earlier iOS Simulator attempts failed launch or were canceled before acceptance.
The ARM crash in 44217472146 is confirmed `SIGKILL (Code Signature Invalid)`,
`CODESIGNING / Taskgated Invalid Signature`: manual signing placed restricted
iOS capability claims into the macOS-host code signature. Xcode-managed
Simulator signing and verified Mach-O decoding fix the issue while retaining
secure-store and navigation acceptance tests. Only standard public-repository
runners are selectable, not paid larger runners.

## Native 0.1.1 review follow-up

Codex findings 4608620008, 4608620018 and 4608620025 are confirmed: late send
results can affect another selected computer, a working sibling can overwrite
a pending bot approval in Live Activity, and image sharing can use the profile
model instead of the destination thread model. Scope send success/error/queued
receipts to runtime generation and connection; select one priority update per
bot; select the destination thread model in both native share clients. Keep
current-connection 401 handling and all server/credential boundaries. New
Simulator-hosted Session/Activity tests and Android share regressions cover
these changes. Local Swift core build, Swift syntax parsing and native
identity/license/HPKE guards pass; full native acceptance is PENDING until
new 0.1.1 runs complete. The older 0.1.0 artifact results above remain
scoped to their original source; do not treat them as proof of this patch.

The iOS follow-up also scopes successful results and errors for history, bot/task
creation, profile/model changes, routines, connector URLs and previews to the
originating connection/runtime. A separate runtime epoch survives ordinary
stream reconnects but advances when the active runtime is replaced. Regression
fixtures cover stale and current history, bot creation, connector URLs, sends,
queued receipts and current-connection 401 handling. iOS build number is 3;
the Android 0.1.1 source is unchanged by this additional Swift-only correction.

## Native 0.1.2 candidate

The iOS question-card gap is corrected with bounded structured payload decoding,
single/multiple-choice and custom-answer inputs, all-question completion,
retryable acknowledged submission and a real Simulator UI fixture. Questions
never grant permissions, including cards that name AskUserQuestion as a tool.
Both formatters use canonical generated wire vectors and JSON escaping when
newlines could imitate question/answer headers. Android honors custom=false and
keeps rejected submissions editable. Both suites read the same fixture; regenerate it with
`node --experimental-strip-types scripts/generate-mobile-question-vectors.ts`.
The earlier iOS 0.1.1 AppTests compilation failed on a duplicate fixture variable;
that is corrected. No app launch or unit-test PASS is inferred from syntax-only
validation. New native CI is required; physical cross-device tests remain NOT RUN.

The first Android 0.1.2 run failed while copying test resources because a second
copy of the shared question fixture had been added to Android's own resource
directory. Keep one canonical fixture in the shared resource directory and
verify regeneration in both native jobs. The fix does not ignore duplicate
resources or weaken test assertions. Notification regressions also exercise
current and stale bot/channel task-switch responses on the real iOS Session.
The structured-question view also rejects a delayed submission acknowledgment
after its computer or question payload changes, preserving the new form state.

At `fe420656502ae0d915f1fe705591142ea8743f0a`, run 44233295362 passed 407
iOS core tests, 12 Simulator-hosted AppTests, the secure-store canary and five
navigation tests. The new structured-question UI test failed before opening
chat: its expected thread row was absent after tapping the disclosure. It now
opens the observed primary agent row and retains all form assertions. This
correction and the additional notification regressions still need fresh CI.

At `6e5b43d37f0bdbe0dffa63320f04772e8cb1382a`, Full CI 44236981994 passed
34 jobs with one skipped. Android 0.1.2 in run 44236989353 passed unit tests,
APK/AAB build and clean-emulator acceptance. Its artifact is 14398157233.
iOS attempt 1 stopped at a Simulator container IPC timeout after app launch;
attempt 2 passed 407 core tests, 14 AppTests including bot/channel notification
isolation, and five navigation tests, but the structured-question UI test
still failed before reaching the form. The pending attention island intercepted
the roster tap. The iOS build-5 correction gives structured questions an explicit
Open chat to answer route and exercises that route in the UI test. Assertions
for missing answers and multiple selections remain unchanged. Test builds
reuse the existing DerivedData; the universal artifact copy remains separate.
Android application source is unchanged by this iOS-only follow-up.

The additional comment pass removes the identified history/implementation
overviews in avatar, geometry, roster, accessory policy, working feedback and
transcript tests. Native catalog headers are regenerated from their corrected
generator. Non-comment Swift/Kotlin content matches the preceding head, the
desktop catalog is unchanged, and all 33 generator tests pass under Vitest.
This targeted pass is not a complete manual audit of every imported comment;
other native UI overviews still need review. Keep the native PR in Draft.

iOS build 5 at `2b0d89b79bf26ce4c39992c93f53c3e4068cc084` qualified in run
44242000128: 407 core tests, 14 AppTests, six UI tests including the full
structured-question route, universal build and secure-store canary passed.
Its artifact is 14400338219. Codex then confirmed another issue: a delivered
notification did not retain its originating computer, so switching computers
before tapping could resolve its IDs against the wrong client.

The build-6 correction records the origin in local notification metadata and
scopes notification grouping/replay IDs by computer. Navigation rejects another
computer or a legacy notification without origin before any lookup or request;
the message directs the person to select the originating computer or open the
conversation manually. Existing in-flight runtime guards remain. Tests cover
real notification request payloads, cross-computer ID collisions, current/stale
navigation, and zero requests for foreign/unscoped notification taps. This
metadata is local to iOS; the server frame and HPKE protocol do not change.
Routine receipt navigation carries its loaded computer ID as well. Routine
views reset on computer changes and guard actions/results against their
origin so the stricter notification boundary preserves internal navigation.
Local core build, syntax, lint/typecheck and identity/HPKE guards pass. Fresh
Xcode/Core/AppTests acceptance is required before qualifying build 6.

## Pending qualification: scoped notifications and channel tasks

The next Android build is 0.1.3; the next iOS 0.1.2 build is 7. Both require fresh native qualification. Android notifications, Intent identity, replay deduplication and recreation tokens now include the originating connection ID; opening a foreign notification refuses before any API request. Legacy unscoped notifications are rejected. Routine receipt navigation carries the loaded computer identity. iOS background channel tasks participate in pending-card discovery, exact room ownership and bounded cold hydration.

At source 583b376f56edbc57f0352c76d4edc55b7150648b, full CI run 44246140113 completed SUCCESS. Its iOS packaging run 44246342967 failed during `simctl launch` (90-second command timeout), before AppTests. The diagnostic screenshot shows the installed StartupBot icon on the Simulator home screen; this is not launch acceptance. The next run uses the standard Intel macOS runner to isolate that Simulator environment and records the exact bounded simctl operation. Universal arm64/x86_64 build and all app, UI, secure-storage smoke checks remain mandatory. No current-head native PASS is claimed before those jobs finish.

The first 4d7841966 native run failed a new iOS regression: cold channel pages were fetched but excluded by the state merge's bot-only owner check (410/411 core tests passed). The owner check now includes exact channel tasks and still rejects unowned pages. Channel Chat equality, hash, live projection and explicit task-selection callbacks also carry thread identity, so a pending background card cannot redraw as the selected sibling. Native AppTests cover the update/navigation projections. Android's first actual build stopped resolving the Foojay bootstrap plugin before compilation. Both modules require installed JDK 17, already selected by CI; the optional JDK download plugin is removed. Native builds/tests are still pending and no passing assertions were removed.

The next iOS 0.1.2 build is 8. Its read receipt includes the displayed channel thread ID. Live Activity content, attributes, widget intent and final Session request guard include the computer origin; old/unscoped activities cannot offer answer buttons, and a foreign origin makes no HTTP call. Core tests cover origin round trips, legacy refusal and matching requests; native AppTests cover both the refusing and positive answer paths. A malformed channel AppTests card fixture now supplies its required subtitle. The Android origin-negative fixture first loads its same-computer roster through the real resolver before verifying a foreign tap sends zero API requests; its original failure was an uninitialized fixture roster, not a permitted foreign request. No assertions were removed. Run 44252285733 was canceled once these confirmed issues made its pending acceptance invalid; its Android report showed 608/609 core tests passing. Current builds must pass all tests before artifact promotion.

## Queue and call qualification

Android 0.1.3 at `a77b5aa4547b90a838f5fe543a456c326590f104` passed native core/app tests, APK/AAB builds and clean emulator launch in run 44255810929 (artifact 14405824729). A subsequent confirmed review found that voice calls could follow the desktop-selected task instead of the displayed task. Android 0.1.4 pins the call to its original thread and computer, refreshes only that task, and dismisses when its origin disappears. The new task-switch regression and fresh emulator acceptance are required before promotion.

iOS build 8 at `f8e48385269dde05f51c5038f3d542c11e4694f4` passed 413 core tests and universal Simulator compilation, then failed at the 90-second simctl install deadline in run 44254562845. This is FAIL, not app acceptance. Build 9 bounds installation retries and verifies the installed bundle/version/build and executable hash before continuing; explicit installation errors still fail. Real secure-storage canary, AppTests and UI tests remain mandatory.

iOS queue cancellation now sends the captured destination thread for bots and channels. Authoritative bot queue frames and fleet snapshots reconcile remote cancellations while preserving channel queues, refusing malformed snapshots, bounding removal tombstones, and ignoring stale HTTP receipts after a newer snapshot. Plain channel sends also retain the displayed task. Added core/HTTP regressions cover these contracts. Local Swift core build, real core contract execution and syntax checks pass; full native acceptance is pending. No physical-device, live-provider, voice or desktop-to-phone matrix PASS is claimed.

## Reference review and draft preservation

The review on `566cd142643d5acc0018678ba43713f6c0bc3f9d` confirmed three additional issues. Android 0.1.5 includes all channel tasks in pending-card discovery and cold hydration; the existing task resolver already supported background channels and gains a regression test. The cold snapshot and cursor commit together only for the originating client. Both native clients decode and render every learned-skill reference as inert selectable text. Missing references, malformed hashes, duplicate or escaping paths leave the proposal deny-only. Server approval/hash validation is unchanged.

Android text-only sends use the same acknowledged, idempotent pipeline as attachments. Failed sends retain the draft, successful replies clear only the captured draft, newer edits survive, and a stale computer cannot receive the captured request or overwrite current state/errors. Regression tests cover draft outcomes, same send ID on retry, zero requests to a mismatched origin, channel cold recovery and reference review boundaries. iOS 0.1.2 build 10 includes the reference preview. Native builds/tests for these changed sources are required; the earlier Android 0.1.4 artifact is provisional and lacks these follow-ups. The Simulator install verifier also checks the debug dylib when present.


## Compact internal candidates — Android 0.1.7 / iOS build 13

Android produces four standalone CPU-specific APKs plus a universal fallback;
AAB delivery remains available. The phone ARM64 APK omits only other CPUs'
native binaries. No locales, DEX code, assets, QR model or features are removed.
CI compares every non-signature entry against the universal APK filtered by
ABI, then verifies every APK signature. Installation/launch acceptance runs on
the x86_64 emulator; physical ARM phones remain NOT RUN. APKs are created and
signed by Gradle, never ZIP-recompressed after signing. Each download includes
its own checksum, commit, signature report and scope of testing.

Simulator downloads use maximum ZIP compression and separate architecture
builds. Each ZIP is extracted and every file, permission and symlink compared
before upload. Debug dylibs contain app code and are retained. Native host
launch, Keychain/App Group canaries, AppTests and UI tests remain mandatory;
the other CPU is build-only until tested on that host. A separate device-SDK
Release archive job compiles for physical iPhone/iPad without signing. An
unsigned xcarchive is neither an IPA nor a TestFlight-ready signed upload.
These changed candidates are not qualified by the earlier build 10 results;
use their new run, checksums and acceptance evidence.

## Store preparation and later updates

The owner reports Apple Developer and Google Play Console accounts exist.
Publisher/contact details and all uploads are deliberately deferred until the
owner requests publication. The build jobs have read-only repository access,
do not retrieve store credentials and never upload to either store.

Keep `ai.startupbot.ios`, its App Group and Keychain groups, and
`ai.startupbot.android` stable. Version/build numbers must increase. Android
production updates require the owner's stable signing key or Play App Signing;
the ephemeral debug APK is not that production update channel. iOS distribution
requires the owner's profiles and certificate. Desktop update sources remain
StartupBot-owned and disabled pending update-integrity acceptance.

Before public submission, complete physical-device pairing/chat/approval/
reconnect acceptance, signed Release installation, privacy/data-safety and
ML Kit disclosures, final published privacy/support URLs, required-reason API
review for every extension, and asset/license/history clearance. Public store
approval is not proven by a simulator build or an unsigned AAB/archive.

References: [Android ABI packages](https://developer.android.com/build/configure-apk-splits),
[Apple distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases/),
[Android 16 KB compatibility](https://developer.android.com/guide/practices/page-sizes),
[Apple privacy manifests](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files).


## Last qualified baseline before compact packages

At `7d362d57b2ff27ddd26f70ba241909f17d9ad09c`,
[full CI](https://github.com/tigerthong1102/MoonBot/actions/runs/44263594696)
completed 34 PASS, 0 FAIL, 1 SKIPPED.
[Native acceptance](https://github.com/tigerthong1102/MoonBot/actions/runs/44263707563)
passed Android unit/build/emulator gates and iOS 420 core tests, 19 AppTests,
6 UI tests, installation/launch and Keychain/App Group checks. Android 0.1.5
and iOS 0.1.2 build 10 remain the qualified fallback until the compact
candidate has its own successful native results. Physical-device and real
computer-pairing acceptance remains NOT RUN.


The first unsigned device archive in run 44273981659 compiled successfully,
then failed the wrapper's `lipo -verify_arch` argument order. The wrapper is
corrected to place the input before that variable-length option. Build 12
also fixes the confirmed Always Allow computer-switch race: a grant and its
approval share one captured client/runtime, rejected grants stop the sequence,
and a changed runtime cannot submit the answer. SessionRequestTests adds
request-level regressions for success, rejection and computer/runtime switches.
New iOS acceptance is required; Android source remains 0.1.6 unchanged.


Build 13 / Android 0.1.7 fixes confirmed review findings for task-specific
channel unread updates, failed spoken sends leaving the mic stopped, and an
iOS voice preview retaining its audio session. Channel updates now use each
task's own unread state and transcript; legacy single-thread rooms remain
supported. Calls resume listening only while their original context is still
active and idle. Preview completion/failure/dismissal releases audio, and late
fetches or old callbacks cannot restart or stop a replacement preview. These
changes require fresh native tests; the smaller 0.1.6 APK remains a separately
qualified fallback, not proof of the changed 0.1.7 source. Store signing and
physical-device acceptance remain deferred gates.


Static iOS App Store artwork is encoded as RGB PNG without an alpha channel.
The white-backed 1024px logo had fully opaque pixels but still carried an RGBA
channel. The generator now refuses nonopaque input and emits RGB without
changing any pixel color. Independent rendering before/after verifies all
1,048,576 pixels identical (RGBA SHA256
`ad51e9358da7661f59f13884af68ef5e1c5f7b2aedbcbc14256330fa5e696290`).
Native verification rejects alpha-channel static store icons, and encoder
regressions check PNG CRCs, exact RGB samples and rejection of transparency.
The in-app transparent robot artwork and all Android assets are unchanged.


Internal Android 0.1.8 / iOS build 14 fixes disconnected search landing windows
on both platforms. The client recovers the actual active leaf and missing
parent segments before publishing focus. It keeps the live branch selection,
rejects missing/repeated parent pages, and bounds automatic search hydration
by 40 pages, 8 MiB of cached thread JSON and a 30-second operation deadline.
An exceeded budget reports an explicit error with manual history navigation
still available. Older HTTP pages cannot roll back a newer stream leaf.
Native request/state updates remain scoped to the originating computer.

The ARM runner jobs in 44280368166 were never acquired by hosted runners;
GitHub annotations explicitly report macOS ARM64 capacity constraints. The
standard Intel runner is an available internal fallback; both Simulator CPU
builds remain mandatory. Only the runner's native CPU receives runtime PASS.
Test compilation and test execution now have separate bounded 900-second
phases; the test execution deadline is unchanged. The exact tested native app
is recopied and signature/entitlement-verified before ZIP staging. No test is
skipped to accommodate runner capacity. An unsigned device archive still does
not authorize installation or TestFlight.

A separate Ubuntu CI failure exposed file-number reuse in the Antigravity log
replacement fixture. Replacement now retains the original file by rename,
and production log identity additionally verifies creation generation before
attributing a quota error. Unprovable identity contributes no log evidence;
the runtime's typed refusal remains authoritative. Focused quota/identity
regressions run without real provider accounts.

## Native review candidate

The Android bot-send path captures the authoritative bot-queue revision at the
POST boundary. A later snapshot, including an empty snapshot for a queue ID the
phone never saw, prevents a delayed receipt from recreating that row. Room
queues remain independent. A real HTTP/SSE regression fails with the old receipt
behavior and passes with the correction; the current local core suite has 623
tests and no failures.

Android call speech refuses to construct an audio engine when focus is denied,
releases the refused focus request, and scopes interruption callbacks to their
playback generation. Cancellation releases an owned in-flight engine. New app
unit tests cover denied focus and successful multi-clip playback; platform CI
must qualify these changes before a new APK is offered.

The imported comment-policy correction covers native sources and Gradle scripts.
Parser comparisons verify identical non-comment code/literal tokens across the
comment-only edits. Copyright/SPDX notices are retained; changed imported source
files carry explicit modification notices and appear in MODIFICATIONS.md.
Focused security constraints, external platform facts and public wire contracts
remain documented. No executable logic, assertion, resource or localization is
removed by that comment-policy pass. Token equality is not a substitute for
native build, app tests or installed acceptance.
