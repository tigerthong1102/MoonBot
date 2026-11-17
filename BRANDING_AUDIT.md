# StartupBot branding audit

Baseline: f8743c457537becc691bb982801b34be212815aa. This inventory does not establish complete trademark or copyright clearance.

| Surface | Status | Evidence / remaining work |
| --- | --- | --- |
| Desktop product / app ID | IMPLEMENTED, NOT RELEASE QUALIFIED | electron-builder uses StartupBot and ai.startupbot.desktop. No installer was built in this review task. |
| Electron and harness data | IMPLEMENTED, PLATFORM ACCEPTANCE PENDING | StartupBot userData and .startupbot are distinct from upstream data; preserve compatibility identifiers rather than mass-renaming wire APIs. |
| Main desktop / PWA icons | IMPLEMENTED | StartupBot assets are selected by builder, main, index and webmanifest. Legacy packaged PNG/ICO/ICNS/SVG entry points now select the same supplied logo. |
| README banner and installer links | CORRECTED | Supplied StartupBot logo replaces the upstream hero; the download table no longer advertises upstream installers. |
| Localized strings | INCOMPLETE | Locale packs still contain upstream product and Cloud names, including en.json and vi.json. Some strings are visible through t(); they require a reviewed overlay or placeholder conversion with locale and behavior tests. |
| Agent avatars and mascot rendering | NEEDS RIGHTS / REPLACEMENT AUDIT | CursorAvatar, CarvedAvatar, mascot body assets and old icon source files remain. Do not infer trademark clearance from the core source license. Preserve agent customization and motion when replacing restricted artwork. |
| Documentation and marketing | INCOMPLETE | README and upstream documentation retain additional product/service references and historical screenshots. Distinguish attribution and references from StartupBot claims; do not invent download, sponsorship or Cloud availability. |
| Notices and source attribution | RETAIN | LICENSE, NOTICE, LICENSING.md and third-party notices must remain. Their upstream names are attribution, not StartupBot product branding. |
| Logo provenance | OWNER-SUPPLIED, RIGHTS NOT INDEPENDENTLY VERIFIED | branding/startupbot-original.png is the supplied reference. Confirm ownership and any required third-party permission before commercial distribution. |
| Enterprise history | RELEASE BLOCKER | The current tree excludes Enterprise; historical access remains a separate distribution issue. No history rewrite was performed. |

Branding is not 100% complete. A green code CI or ready-for-review PR does not remove these release gates. No public release, production website deployment or signing/notarization was performed.
