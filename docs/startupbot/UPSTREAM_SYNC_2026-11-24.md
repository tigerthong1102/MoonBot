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
