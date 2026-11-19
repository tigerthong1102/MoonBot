# StartupBot personal and group inbox

This worker serves the Vietnamese inbox at its HTTPS origin. It has a dedicated D1 database, email OTP sessions, and static browser assets. On desktop, the sidebar and application menu open chat inside the StartupBot window. The panel loads the configured HTTPS origin in a sandboxed view with a separate persistent session. Use the back link to return to the bot. In the pilot desktop, Settings → Your account uses the same session as Messages. The first verified email OTP creates the account. Later sign-ins reuse its identity, and signing out from Settings also signs out of Messages. The web browser keeps a separate session.

The open inbox uses session-authenticated WebSocket change notifications. The app retrieves content using its regular membership-checked API and polls when the connection is unavailable.

## Use

The operator sets the initial testers in the INBOX_PILOT_EMAILS secret, using a comma-separated list. Invited guests can also sign in. Choose **Tạo cuộc trò chuyện** for a direct conversation or a named group. A group owner can invite up to 19 other people. Registered recipients see invitations in the inbox. For a new address, the sender chooses Vietnamese or English and can include a short personal note. The service sends one invitation email per recipient per 24 hours. It includes a link to stop future invitation emails. The guest must verify that same email address within seven days and accept the invitation. A forwarded invitation gives no room access. The selected language applies to the email template. The sender writes the personal note in the intended language. The owner sees accepted members. Invite responses are generic, including when the address is unknown, blocked, or at capacity.

Each member sees new posts from the moment they join. A direct chat accepts posts after both people have joined. The group owner can remove members and close the room. Members can leave or block future invitations from the owner. Blocking also ends direct messaging with that account. People can unblock an account in **Người đã chặn**.

Markdown files can be sent intact at the normal file limit. On a staged .md or .markdown file, **Chia sẻ dưới dạng skill** previews UTF-8 text as a skill post. The message limit is 8,000 characters and the serialized API request is limited to 16 KiB. Other staged files and the current draft are preserved.

**Skill dạng văn bản** and **Bàn giao công việc** show a preview before sending. A recipient can save a private copy, download a skill as SKILL.md, or mark a received task complete. Downloading or reading a skill does not install it. The received task belongs to the recipient's inbox. No agent starts and no workspace credentials, files, tools or chat history are shared.

A member can attach a file up to 50 MB (50,000,000 bytes). For Markdown files of at least 2 KiB and other files of at least 128 KiB the app uses lossless gzip during upload when it saves at least 5%. For large multipart uploads the app compares a sample using Brotli and gzip, then compresses off the UI thread when Brotli wins. The file hashes are always over the original data. Compressible consecutive parts can share one request. Larger payloads start with a single part. The app uses one to three upload requests at a time and reduces concurrency when transfer times deteriorate. A transient connection failure retries the same request up to twice. Each part is verified against its position and SHA-256 before publication. Retrying a staged upload sends only its missing parts. Quotas and displayed sizes use the original bytes. Each account can upload up to 20 retained files totaling 60 MB per rolling 24 hours. The internal pilot reserves up to 180 MB of raw attachment data in total. Uploads are published after all parts arrive. The daily cleanup reclaims incomplete uploads older than an hour. Downloads require current membership, respect the join boundary and expire with the post. Files download as attachments; the service does not inspect their contents for malware.

Membership exposes each active member's email address to the other active members. Messages become unreadable through the service after 30 days. A daily scheduled job deletes expired posts. Removing a person or closing a room cannot recall downloads or saved copies. Recipients can delete their saved copies. The service reads plaintext to serve authorized users. It provides no end-to-end encryption.

## Configure a StartupBot environment

Use a StartupBot-controlled Cloudflare account and a verified email sender. The worker needs a D1 database bound as DB and Cloudflare Email Sending bound as EMAIL. The included config names a new database and contains no production IDs. Record the dedicated D1 database ID in the environment's Wrangler configuration. Give that environment its own strong random BETTER_AUTH_SECRET, set BETTER_AUTH_URL to the exact public HTTPS origin without a trailing slash, and set EMAIL_FROM to the verified sender. Restrict the sending binding to that address. Include these runtime variables when deploying the worker and its assets.

From cloudflare/control-plane, use the inbox config for every command. For example, these commands verify packaging and migrate a local database.

```sh
pnpm exec wrangler deploy --dry-run --config inbox/wrangler.jsonc
pnpm exec wrangler d1 migrations apply DB --local --config inbox/wrangler.jsonc
pnpm exec vitest run test/personal-inbox.test.ts
```

For a live environment, apply inbox/migrations to the dedicated remote D1 database, deploy that environment's worker and assets, and verify OTP delivery and revocation with separate consenting test accounts. For the desktop, package the HTTPS origin as extraMetadata.startupbotInboxOrigin, set STARTUPBOT_INBOX_ORIGIN in its launch environment, or set origin in inbox-service.json under its Electron user data directory. Restart the updated app. The menu item lives in the StartupBot menu on macOS and the File menu on Windows and Linux. Unconfigured builds keep the inbox entry hidden.

The inbox uses its own OTP identities. It does not contact any upstream account or relay service. Operators must manage database access, backups and their retention separately.
