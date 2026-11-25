# Archive held app events from a closed profile copy

Held app events are not executed by this procedure. Use it only after reviewing the affected automations and deciding to keep those events blocked. The original event payloads can contain private connector data; keep the archive private and include it in a separately protected backup if it must be retained.

1. Quit StartupBot completely. Make a closed copy of its data directory and preserve the original. Work only with the copy. The recovery tool refuses symbolic links, junctions and special files; replace any such entries with independent files in the copy before proceeding.
2. On macOS, Linux or Windows with Node 24 or later and this checkout's dependencies installed, choose two new, separate directories outside the copied data directory and every workspace: one for recovery files, one for the private archive. They must not exist already. On Windows their existing parent directories must be owned by the current account and have protected ACLs granting full control only to that account. The utility requires PowerShell and a filesystem supporting these ACLs; it refuses shared or inherited parent permissions.
3. Run:

   ```sh
   node scripts/archive-held-app-events.mjs --profile /path/to/closed-data-copy --workspace /path/to/workspace --output /path/to/new-recovery-directory --archive /path/to/new-private-archive-directory
   ```

   The archive contains the original automation ledger and full held-event store, protected by mode 0600 in a mode 0700 directory on Unix, or by an access control list limited to the current account on Windows. The recovery directory is a complete data-folder copy with a version 2 format marker, a version 2 ledger whose compact receipts keep replayed IDs blocked, and an empty held-event store. During copying an incompatible temporary marker prevents either app version from opening an incomplete copy. The utility does not contact the broker or modify the source. Events without an established matching account scope, complete payload or receipt, or a saved cursor past the event are refused.
4. Keep the archive outside all shared workspace and Team backup roots. Test the complete recovery copy with the original connected-app installation and check the automations and account. Never copy its ledger separately into an existing profile or remove its format marker. Keep the original closed copy and archive until recovery has been verified. For rollback, restore the complete original copy with the app version that produced it. An older app may not understand newer automations even if their data is version 1; do not open the version 2 copy with the older app.

This frees the held-event store, including when it has reached its 2 MB limit. Compact receipts continue to occupy space in the ledger; disk capacity is still finite. Legacy held records without a verified source account and files with embedded event payloads require a separate recovery method. Nothing in this process reenables a held event or creates a schedule.

Workspace backup cannot safely transfer version 2 data or held events while older releases remain supported. For those profiles, completely quit the app and keep a protected copy of the entire data folder, including `data-format.json` and the private archive. An incomplete or corrupted marker cannot protect a copy from an older app.
