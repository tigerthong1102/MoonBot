# Upstream synchronization

The weekly report compares the checked-out branch with upstream main and lists commits, license and dependency changes, conflict markers, and recent releases. Review commit messages and upstream security advisories manually; the report does not classify security fixes or run a merge. It does not create a branch, merge, publish, or use a write token.

Fetch `upstream/main` and pin its SHA alongside the current StartupBot main
SHA. Review license, dependency, asset and service changes first. Import
approved commits or file changes into a separate integration branch, recording
the source SHA for each batch. A merge of raw upstream history would add
restricted Enterprise revisions to the fork's ancestry even if the final tree
excluded the directory.

Keep StartupBot product copy, app IDs, release configuration and update
ownership separate. Preserve required source notices and protocol compatibility.
Verify each batch with focused tests, then run lint, typecheck, OSS build,
isolated server and applicable desktop/mobile checks. Review hosted
authentication for fail-closed behavior. Open a PR for review.

For a security fix, check its scope and dependencies, backport the smallest
complete change and exercise the affected boundary in a fixture. To roll back,
revert the integration changes without rewriting published history.
