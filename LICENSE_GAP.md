# License and distribution gaps

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
