# Upstream integration, November 24, 2026

This is the first batch for the current synchronization. It integrates 38 upstream
commits. Each imported commit records its source SHA. The remaining changes need
a scope, license, dependency or compatibility decision before import.

- StartupBot base: `323031f968f624978147ae6bbc3471c1b5a1110d`
- OpenMausBot source: `36e9f4b8f0996248fa5ce0bd76367ebe67685e97`
- Common ancestor: `676c29f63c400f79184ca131b00aad666eccf9cd`
- Ancestry comparison at those pins: 406 fork-only and 1,963 upstream-only commits, including merges. 619 paths changed on both sides from the common ancestor, with renames counted as add/delete. A path changed on both sides is a review candidate, not necessarily a Git conflict.

Included changes cover sign-in code delivery, existing TOTP keys, connector log
redaction, file permissions, live file authorization, browser wake and display
handling, Vietnamese IME input, clipboard data, attachment retries, routine
scheduling and performance, event polling, conversation navigation, data moves
and existing peer synchronization. StartupBot's README and companion description
present the StartupBot product. The actual source repository URL and compatible
CLI, locale and protocol identifiers stay valid. Upstream credit remains in
`LICENSE`, `NOTICE` and the attribution text.

| Further work | Boundary |
| --- | --- |
| Library and conversation memory | Port the registry and storage changes with the fork's existing chat, Memory and Library features. Validate migration, visibility and export. |
| Skill Burger and saved workflows | Port as a self-contained feature, including execution permissions, confirmation, storage and mobile parity. |
| Devices, browser desktop, engines | Port the OSS behavior with StartupBot identity, platform safety and the fork's existing compatibility. |
| Hosted relay, push and cloud control | Confirm service rights and an approved operator configuration before exposing features. Keep self-hosted OSS improvements in scope. |
| Avatar engines and other vendored code | Review the license and attribution for each component separately. Upstream documents separate MIT terms for Open Bot Avatar and identifies its own name and mascot as trademarks. |
| Enterprise, release credentials and upstream channels | Exclude restricted source, new upstream release history, proprietary marks and unpublished permissions. Preserve StartupBot's independent release configuration. |

A source transfer carries the file-level notices and licenses that apply to it.
Review new assets and packaged dependencies separately from source. This batch
changes no dependency lockfile, release workflow, desktop identity, native mobile
project or upstream notice. It does not clear pre-existing history or assets for
commercial redistribution.

References: [upstream licensing at the pinned commit](https://github.com/milind-soni/OpenMausBot/blob/36e9f4b8f0996248fa5ce0bd76367ebe67685e97/LICENSING.md)
and [Apache License 2.0, sections 4 and 6](https://www.apache.org/licenses/LICENSE-2.0).

## Second batch

This batch was reviewed against upstream `868a4746d4a6875476501cde7114ab06ad2078d2`. It builds on PR #54. The individual commits retain their upstream sources so each group can be reviewed and reverted independently. The groups share a CI run to limit runner costs.

| Upgrade | Upstream sources | StartupBot integration |
| --- | --- | --- |
| Library | `6ef53dd80`, `5179f8410`, `285812c1a`, `66a5c0860` | Lists published pages, apps and shared files from conversations the viewer can read. The current transcript remains usable during an offline refresh. The expanded list in the panel and SQLite query plans have separate tests. |
| Conversation notes | `a1cf5dc6c`, `33f06c6bc` | Adds a per-conversation editor while keeping bot-wide notes, topics and upkeep. The editor keeps the draft on a version conflict. The notes endpoint checks the current viewer's access. New note lookups across chats are restricted to direct turns and the calling bot's accessible conversations. Team memory stays on its existing layers. |
| Skill Burger | `d7791369e` | Captures selected chat activity as a saved workflow skill on standalone installations. Owners can inspect, rename and remove saved workflows. The existing run verification card remains available. Saved skill instructions direct agents to use the existing tools and approvals when a person requests the skill. |
| Mail and briefing | Outlook files from `2e6c3d775`, then `1882ffe9b` | Uses the configured connected-apps account to read Outlook and open the Outlook web link. Outlook rows have no Gmail draft slot. Gmail behavior remains covered by the same suites. |
| Handoffs | `28fb7ce7f`, `fda74938d`, `1313730f2`, `5b2a82c52` | Reports that an assignment was sent in the same turn, with wording that matches whether its result will come back. |
| Pi context | `6a27c61de`, `420606944` | Reports prompt size for compaction, including cached context. |

The deterministic Skill Burger runner from `b82487923` and peer replay from `f25f8181f` remain pending. Replaying commands and writes needs to use StartupBot's execution and approval path. The local capture uses an editable title derived from the chat and makes no separate summary-model call. Team Cloud workflow sharing needs a policy for captured client data before it can be enabled.

The fork keeps its StartupBot brand, existing device protocol, release settings, `LICENSE` and `NOTICE`. This batch adds no Enterprise code, upstream service endpoint, third-party binary or trademark asset. Device and hosted-service upgrades still follow the dependency, license and service checks above.
