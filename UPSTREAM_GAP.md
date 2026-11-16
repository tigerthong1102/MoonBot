# Upstream integration audit

On 2026-11-16, `c9bb31e81` was 7 commits ahead and 64 commits behind
`676c29f63`. Worktree `integration/upstream-20261116` merged that upstream head
as `16e48c5c4` with no textual conflicts; the resulting tree has no tracked
`enterprise/` files. The merge retains upstream ancestry, including historical
Enterprise material already present in history. Removing a working-tree folder
is not a history or distribution clearance.

The merge includes upstream usage caps, local file tools, ADB phone input,
configuration backups, runtime recovery, browser/process limits, Windows and
macOS fixes, and locale updates. Inclusion is not a claim of behavioral parity;
see FEATURE_PARITY.md and CI results. Future upstream commits after `676c29f63`
are not included.

Sync procedure: fetch upstream, record both heads and review licenses and
trademarks; merge into an isolated integration branch; ensure `enterprise/`
remains absent and review asset/service changes; run focused tests, full CI,
Docker and platform smokes; open or update a PR for human review. Never auto
merge or publish. Regression must cover branding, data isolation, device pairing,
protocol compatibility, user skills and integrations. This integration merge
is the first real sync exercise; complete acceptance remains pending.
