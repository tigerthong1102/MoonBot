# Upstream integration audit

Review baseline: `0c403c71f45d819888eb0a8a4671c257521fac54`. No further
upstream merge was performed during the follow-up review; future gap counts
must be recalculated from the current upstream head.

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

## Desktop/native branch baseline — 2026-11-18

The internal desktop branch started from main merge `cd139d78c98c74797c1b07c9f0476f64664199d5`.
While it was in progress, main advanced to `712adf52c215f3137fbb5a9bd108542e029d898d`
through PR #2's selected OSS backports. That merge is not imported automatically
into this work branch; artifacts identify their own exact source SHA. PR #3's
checks also exercise GitHub's merge result against current main. Refresh the
approved main baseline before future production qualification. No new automatic
upstream merge, release or deployment is introduced here.

Native source pins and deviations are recorded in PR #4's platform MODIFICATIONS
files. Health identity, Bonjour, pairing aliases, HPKE v1 and fixed key-check
wire bodies remain compatible. Product UI/branding, native install identities
and Keychain/App Group identifiers are separate. Native version numbers are
independent; they are not claims of full parity with an upstream store build.
