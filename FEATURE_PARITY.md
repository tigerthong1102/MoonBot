# StartupBot feature parity audit

Audit baseline: StartupBot `c9bb31e81`, upstream `676c29f63`; integration merge
`16e48c5c4`. Presence in the tree is not an acceptance test. Status is for the
integration branch unless stated otherwise.

Follow-up review baseline `0c403c71f45d819888eb0a8a4671c257521fac54`: Docker
and website Actions passed, but full CI and desktop acceptance remain pending.
Subsequent update-route changes disable the inherited server updater; see
REVIEW_AUDIT.md and test the final commit separately.

| Area | Status | Evidence and remaining work |
| --- | --- | --- |
| Agents, AI providers, MCP, skills, memory | Retained; acceptance NOT RUN | Core remains present; provider accounts and external services need independent authorization and live testing. |
| Computer Use and browser | Retained; acceptance NOT RUN | Drivers and security boundaries remain; clean machine and isolated Computer Use/browser workflows still need platform verification. |
| Routines and scheduling | Retained; verification in progress | Upstream failure spacing/recovery changes integrated; Windows recovery test previously failed around an extra scheduled run and needs investigation. |
| Usage caps, file tools, configuration backups, Android control | Integrated; verification in progress | Included in upstream merge; review and focused tests required before acceptance. |
| Phone pairing, authorization, revocation, E2E | Protocol and server retained; native clients NOT RUN | `companion/`, `packages/phone-protocol/` and `relay/` remain. No native iOS/Android app source or cross-device acceptance was established. |
| LAN and Tailscale | Retained; end-to-end NOT RUN | Direct routes require a reachable running host; Tailscale additionally requires its separately operated network. |
| HTTPS and relay | Retained; independently operated deployment NOT RUN | HTTPS needs operator-controlled TLS and endpoint. Upstream relay/cloud endpoints and account services require authorization and must not be assumed available for StartupBot. |
| Docker | OSS image retained | PR head `ce000d931` passed both Docker jobs; the integration commit has not yet run Docker Actions. |
| Locales and phone web app | 16 catalogs retained; browser fixture passed on PR head | Vietnamese catalog is incomplete; physical phone installation and integrated build still require verification. |
| Enterprise hosted adapter | Removed from working tree | Hosted configuration fails closed without the adapter. Enterprise-specific tests require the unavailable layer. |
| Desktop auto-update and release | Temporarily disabled | No independent signed release feed has been qualified. Do not enable until release and update integrity are verified. |
| Windows/macOS/Linux installers | Existing packaging retained; rebranding incomplete | Builder identity, icons, data isolation and actual clean installs need work. Do not distribute upstream-branded artifacts as StartupBot. |
| iOS/Android native | Missing from this checkout | Upstream release branches contain native source; root Apache terms are preliminary evidence, while dependency and asset review and platform builds remain outstanding. No native client or store readiness is claimed. |

A local agent requires its host to remain awake and online. A phone is a remote
client, not an always-on backend. No paid service has been provisioned.

## Internal platform delta — 2026-11-18

Desktop v3 has real Windows and Intel DMG install/launch acceptance in
44215347938. Desktop v4 (`edd8456ad4f8c1f0966f62b93ea49ae14b104e53`)
passes native Apple Silicon DMG install/launch, onboarding, helper name/image,
isolated agent/chat, data/auth and bundled browser/server smokes in 44221896486.
Windows v4 builds but its onboarding smoke fails; v3 remains the qualified
Windows download. No v4 Windows runtime PASS is inferred from v3.
Real-provider billing and actual Computer Use are NOT RUN. Legacy history and
custom names/avatars remain user data.

Android APK/AAB and emulator launch PASS in 44215532499. iOS Simulator passes
402 core tests, universal compilation, native ARM installation/launch,
Keychain/App Group and five navigation tests in 44220727356. The clients,
pinned OSS source and licenses are in PR #4, separate from desktop PR #3.
Physical pairing/chat/approval/reconnect across the desktop/mobile matrix
remain NOT RUN. Default Cloud and organization portals stay inactive unless
explicitly configured. See RELEASE_READINESS.md for exact source/artifact
links and the remaining full-CI gates. This delta supersedes historical
platform-presence rows above; it is not store or commercial clearance.
