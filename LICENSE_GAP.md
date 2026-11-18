# License and distribution gaps

Review baseline: `0c403c71f45d819888eb0a8a4671c257521fac54`. The present
audit does not constitute legal clearance or a complete dependency SBOM.

The repository's LICENSE, NOTICE, LICENSING.md and third-party notices must be
retained and reviewed together. Upstream's `enterprise/` is governed by a
separate source-available license; its production, hosted and white-label terms
are not an Apache grant. The folder is absent from the integration tree but its
content is present in Git history. Public history and fork distribution need
owner and qualified legal review before any distribution decision; no history
rewrite has been performed.

Upstream identifies OpenMausBot/MausBot names and mascot as trademarks. Existing
assets, icons, copy, protocol and service links still require inventory and
replacement or documented permission. Preserve attribution without implying
endorsement. Third-party binaries, fonts, browser and bundled CUA components
retain their own terms; complete dependency and SBOM review is pending.

Native source is absent from main, but upstream release branches contain it:
[`android-release/v1.5.0`](https://github.com/milind-soni/OpenMausBot/tree/android-release/v1.5.0/android)
(`16ad4080f20fcd2fb310e27d527ce0f6a36e3724`) and
[`ios-release/build13`](https://github.com/milind-soni/OpenMausBot/tree/ios-release/build13/ios)
(`37a9d185d825641750b865114497c0ddab43e6dd`). Their root licensing files
state Apache 2.0 outside `enterprise/`, subject to third-party terms and
trademark exclusions. This is preliminary evidence for code reuse, not a
completed dependency, asset or provenance review. The branches contain branded
assets and Enterprise trees; none has been copied into StartupBot. Review the
specific files, notices, dependencies and compatibility before selective reuse.
An independent implementation of the documented protocol remains an option.

Upstream cloud, relay, identity, analytics and download endpoints are not a
permission to operate against their services. Inventory and replace or disable
unapproved dependencies before shipping; no independent service has been
provisioned. This is an engineering audit, not a legal determination.

## Native source and internal build delta — 2026-11-18

PR #4 imports native Android from `16ad4080f20fcd2fb310e27d527ce0f6a36e3724`
and iOS from `37a9d185d825641750b865114497c0ddab43e6dd`, preserving each pinned
root Apache-2.0 LICENSE, NOTICE and LICENSING.md beside the source and in app
resources. No Enterprise tree, upstream compiled app or store marketing assets
are imported. New install identifiers/default launcher and avatar use the
owner-supplied robot; implementation/protocol identifiers and attribution remain.

Android's bundled ML Kit QR scanner has Google's separate terms and potential
SDK metrics/model communication; it is not covered by the root Apache license.
Native localization, store privacy disclosures and full third-party review remain
release gates. The owner-supplied image's commercial rights and the repository's
retained Enterprise history are not cleared by internal smoke tests. No signing
secrets or paid services are provisioned. Internal artifacts do not authorize
a commercial or app-store release.
