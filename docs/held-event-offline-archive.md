# Archive held app events from a closed profile copy

Held app events are not executed by this procedure. Use it only after reviewing the affected automations and deciding to keep those events blocked. The original event payloads can contain private connector data; keep the archive private and include it in a separately protected backup if it must be retained.

1. Quit StartupBot completely. Make a closed copy of its data directory and preserve the original. Work only with the copy.
2. On macOS, Linux or Windows with Node 24 or later and this checkout's dependencies installed, choose two new, separate directories outside the copied data directory and every workspace: one for recovery files, one for the private archive. They must not exist already. On Windows the utility requires PowerShell and a filesystem that supports private access control lists.
3. Run:

   ```sh
   node scripts/archive-held-app-events.mjs --profile /path/to/closed-data-copy --workspace /path/to/workspace --output /path/to/new-recovery-directory --archive /path/to/new-private-archive-directory
   ```

   The archive contains the original automation ledger and full held-event store, protected by mode 0600 in a mode 0700 directory on Unix, or by an access control list limited to the current account on Windows. The recovery directory contains the original ledger and a compact held-event store whose receipts keep replayed IDs blocked. The utility does not contact the broker or modify either source file. Events without an established matching account scope, complete payload, or a saved cursor past the event are refused.
4. Keep the archive outside all shared workspace and Team backup roots. To test, make another copy of the closed profile and replace only `app-triggers.json` and `app-triggers.json.held` in that copy with the two recovery files. Open the copy with the original connected-app installation and check the automations and account. Keep the original copy and archive until recovery has been verified.

This frees active held-event slots; compact receipts still occupy space and the 2 MB store limit remains. Legacy held records without a verified source account and files with embedded event payloads require a separate recovery method. Nothing in this process reenables a held event or creates a schedule.
