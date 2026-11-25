# StartupBot skill catalog

This catalog contains 62 skills, including 57 curated candidates, four Google Workspace helpers, and the upstream HyperFrames media-use companion. Each directory includes the instructions, Apache-2.0 terms, upstream notices where present and a source record. The index pins the reviewed upstream commits. Each source record lists the files omitted from that snapshot.

StartupBot copies the catalog into the workspace skill library at startup unless the workspace explicitly sets `features.skillsLibrary` to false. The imports are disabled for review and have no bot assignments. An existing library entry with the same name takes precedence. Existing choices persist on restart.

Open Skills library above the chat to browse the complete list and choose Use in chat. The first use opens the instructions for review. Settings → Skills library also offers assignment and import controls. Vietnamese search accepts words with or without accents. Open a skill to read its instructions, enable it, then assign it to a bot. Type `/skill-name` in that bot’s chat to use it.

## Distribution

Keep each skill's `LICENSE`, `SOURCE.md` and upstream notices with its instructions and files. Several skills use tools or services that the customer configures separately. The catalog supplies instructions and selected source helpers. It contains no provider credentials or third-party executables. HyperFrames includes licensed font files and their notices. Some upstream OOXML schemas are not included; see each source record.

- The Word, Excel and PowerPoint instructions use an available document tool. Excel retains the upstream recalculation helper for workspaces with a compatible LibreOffice. The catalog excludes the upstream OOXML validators and their schemas.
- HyperFrames uses an existing local CLI. Its instructions request telemetry to be disabled and require permission for external uploads and paid operations. Preset fonts, layouts and helper scripts are included with notices. The media-use companion retains upstream instructions and helpers; 19 third-party sound files are omitted pending confirmation of redistribution rights. These instructions are not a runtime cost or network enforcement mechanism.
- The Google Workspace recipes use the configured CLI and require authorization for the customer's account. The four helper skills are `gws-shared`, `gws-docs`, `gws-drive` and `gws-forms`.
- The ByteDance subtitle and narration instructions use configured services. The catalog excludes upstream dynamic update, upload and credential-provisioning scripts for these workflows.
- Third-party connections and marketplace data have separate service terms. Licensing the skill files does not grant access to the service or rights to customer input and third-party output.

The review covered the 57 Apache-2.0 candidates from the prior four shortlists. Other references, including MIT, AGPL and CC BY projects, were outside that shortlist. The BytePlus Viral Creative Rewrite sample has its own restricted license and is excluded. The Alibaba Cloud AI Ops samples with conflicting license statements are excluded.

Distribution and modification conditions are in section 4 of the Apache-2.0 license. Names and trademarks are covered separately in section 6.
