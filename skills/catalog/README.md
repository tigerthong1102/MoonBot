# StartupBot skill catalog

This catalog contains 57 curated skill candidates and four Google Workspace helper skills. Each directory includes the instructions, Apache-2.0 terms, upstream notices where present and a source record. The index pins the reviewed upstream commits. Each source record lists the files omitted from that snapshot.

StartupBot copies the catalog into the workspace skill library at startup when `features.skillsLibrary` is enabled. The imports are disabled for review and have no bot assignments. An existing library entry with the same name takes precedence. Existing choices persist on restart.

## Distribution

Keep each skill's `LICENSE`, `SOURCE.md` and upstream notices with its instructions and files. Several skills use tools or services that the customer configures separately. The catalog supplies instructions and selected source helpers. It contains no provider credentials, third-party executables, embedded fonts or OOXML schema files.

- The Word, Excel and PowerPoint instructions use an available document tool. Excel retains the upstream recalculation helper for workspaces with a compatible LibreOffice. The catalog excludes the upstream OOXML validators and their schemas.
- HyperFrames uses an existing local CLI. The adapted instructions disable CLI telemetry per invocation and exclude upstream beacons, preset fonts and cloud upload instructions.
- The Google Workspace recipes use the configured CLI and require authorization for the customer's account. The four helper skills are `gws-shared`, `gws-docs`, `gws-drive` and `gws-forms`.
- The ByteDance subtitle and narration instructions use configured services. The catalog excludes upstream dynamic update, upload and credential-provisioning scripts for these workflows.
- Third-party connections and marketplace data have separate service terms. Licensing the skill files does not grant access to the service or rights to customer input and third-party output.

The review covered the 57 Apache-2.0 candidates from the prior four shortlists. Other references, including MIT, AGPL and CC BY projects, were outside that shortlist. The BytePlus Viral Creative Rewrite sample has its own restricted license and is excluded. The Alibaba Cloud AI Ops samples with conflicting license statements are excluded.

Distribution and modification conditions are in section 4 of the Apache-2.0 license. Names and trademarks are covered separately in section 6.
