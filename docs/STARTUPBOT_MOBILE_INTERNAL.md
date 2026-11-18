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
and Keychain access groups. The internal simulator bundle contains arm64 and
x86_64 simulator code. It cannot be installed on an iPhone, used as an IPA, or
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
