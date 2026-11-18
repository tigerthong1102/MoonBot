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
