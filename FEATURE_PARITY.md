# StartupBot feature parity audit

Audit baseline: StartupBot `c9bb31e81`, upstream `676c29f63`; integration merge
`16e48c5c4`. Presence in the tree is not an acceptance test. Status is for the
integration branch unless stated otherwise.

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
