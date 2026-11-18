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


## Internal desktop follow-up — 2026-11-18


Scope: `build/startupbot-internal-desktop-20261118`, based on merged main
`cd139d78c98c74797c1b07c9f0476f64664199d5`. This is an internal test build;
no public release, upstream updater, website deployment or commercial clearance.

| Surface | Change | Evidence / limitation |
| --- | --- | --- |
| Installer, Dock, taskbar, splash, PWA | StartupBot identity, owner-supplied robot, rounded tile with transparent outer corners, correctly sized ICNS/ICO/PNG | Native icon container tests and actual arm64 packaged launch |
| Helper sidebar, chat header, composer, introduction | StartupBot factory helper and robot avatar | Real packaged renderer onboarding and helper screenshot in smoke artifact |
| Existing factory helper | Rename only marked legacy factory aliases; preserve identity, transcripts, model, instructions, access and uploaded avatar | Default-bot regression fixtures cover restart, collisions and custom names |
| Product copy and agent instructions | StartupBot in UI, server messages, prompts, companion pages and bundled skills | AST literal guard, including escaped newlines; user text is never rewritten |
| Localization | Product name updated in all 16 existing catalogs; keys and placeholders retained | Locale validation; hashes refreshed only for the 146 changed English branding keys and already-current translations |
| Attribution and compatibility | LICENSE/NOTICE, author, synchronization markers, wire headers, legacy error mapping and upstream OSS dependency source remain | Bounded guard exceptions, not product branding |
| Independent services | StartupBot update source stays disabled; fork help/announcement links; no inherited PostHog project; unapproved Boat offer inactive | Configuration and telemetry regression tests |
| Personalization | User images and non-default geometric avatar choices remain | Avatar rendering tests; no replacement of personal chat text |

Local verification before the branding commit: lint, typecheck, production UI,
server and companion builds passed. Branding/package gates: 29 tests passed.
The new arm64 app passed actual packaged onboarding, helper branding, fake-engine
agent/chat, OS-backed credential-file persistence, isolated data and unauthenticated
mutation denial. The first broad Electron run exposed stale branding assertions;
these were corrected without changing access checks. Broader changed-file tests
and fresh Windows/macOS workflow results are reported separately by exact SHA.

The fixture does not exercise a paid model or manipulate the user's real desktop.
Native iOS/Android source audit/build is separate; no native mobile completion is
claimed here. Existing copyright/trademark/distribution gaps remain in LICENSE_GAP.md.

HPKE v1 keeps its original domain separator, pinned by both an exact-value
regression and the independent Apple CryptoKit ciphertext test. Packaging gates
run credential-envelope compatibility tests before building installers.
