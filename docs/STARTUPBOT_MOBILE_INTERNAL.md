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

## Qualified internal artifacts — 2026-11-18

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
