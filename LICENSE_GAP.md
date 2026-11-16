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

No native mobile source with a verified commercial redistribution grant was
identified in this checkout. Upstream describes companion apps but does not
establish source access or a license in the checked documentation. Do not copy
mobile implementation or branded assets without verification. An independent
client should implement the documented interoperable protocol, use original
assets, platform secure storage and fail-closed authorization, with separate
license review and tests.

Upstream cloud, relay, identity, analytics and download endpoints are not a
permission to operate against their services. Inventory and replace or disable
unapproved dependencies before shipping; no independent service has been
provisioned. This is an engineering audit, not a legal determination.
