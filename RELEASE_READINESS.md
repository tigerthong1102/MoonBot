# Release readiness

| Target | Decision | Evidence / blocker |
| --- | --- | --- |
| Windows installer | NO-GO | Clean-machine install, product identity, separate data directory, signing and updater not qualified. |
| macOS Apple Silicon / Intel | NO-GO | Full Xcode, signed/notarized builds and clean-machine acceptance unavailable. |
| Linux | NO-GO | Package identity, asset rights, independent update destination and install smoke require verification. |
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
