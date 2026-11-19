# StartupBot personal and group inbox

This worker serves the Vietnamese inbox at its HTTPS origin. It has a dedicated D1 database, email OTP sessions, and static browser assets. The desktop menu opens the same origin in the system browser. The trusted desktop process reads only the configured origin. Chat sessions stay in the browser.

## Use

Both people sign in with their email addresses before the first invitation. Choose **Tạo cuộc trò chuyện** for a direct conversation or a named group. A group owner can invite up to 19 other people. Invitations arrive in the inbox. The owner sees accepted members. Invite responses are generic, including when the address is unknown, blocked, or at capacity.

Each member sees new posts from the moment they join. A direct chat accepts posts after both people have joined. The group owner can remove members and close the room. Members can leave or block future invitations from the owner. Blocking also ends direct messaging with that account. People can unblock an account in **Người đã chặn**.

**Skill dạng văn bản** and **Bàn giao công việc** show a preview before sending. A recipient can save a private copy, download a skill as SKILL.md, or mark a received task complete. Downloading or reading a skill does not install it. The received task belongs to the recipient's inbox. No agent starts and no workspace credentials, files, tools or chat history are shared.

Membership exposes each active member's email address to the other active members. Messages become unreadable through the service after 30 days. A daily scheduled job deletes expired posts. Removing a person or closing a room cannot recall downloads or saved copies. Recipients can delete their saved copies. The service reads plaintext to serve authorized users. It provides no end-to-end encryption.

## Configure a StartupBot environment

Use a StartupBot-controlled Cloudflare account and a verified email sender. The worker needs a D1 database bound as DB and Cloudflare Email Sending bound as EMAIL. The included config names a new database and contains no production IDs. Record the dedicated D1 database ID in the environment's Wrangler configuration. Give that environment its own strong random BETTER_AUTH_SECRET, set BETTER_AUTH_URL to the exact public HTTPS origin without a trailing slash, and set EMAIL_FROM to the verified sender. Restrict the sending binding to that address. Include these runtime variables when deploying the worker and its assets.

From cloudflare/control-plane, use the inbox config for every command. For example, these commands verify packaging and migrate a local database.

```sh
pnpm exec wrangler deploy --dry-run --config inbox/wrangler.jsonc
pnpm exec wrangler d1 migrations apply DB --local --config inbox/wrangler.jsonc
pnpm exec vitest run test/personal-inbox.test.ts
```

For a live environment, apply inbox/migrations to the dedicated remote D1 database, deploy that environment's worker and assets, and verify OTP delivery and revocation with separate consenting test accounts. Set STARTUPBOT_INBOX_ORIGIN to the same HTTPS origin in the desktop launch environment, then restart the updated app. The menu item lives in the StartupBot menu on macOS and the File menu on Windows and Linux. Unconfigured builds keep the inbox entry hidden.

The inbox uses its own OTP identities. It does not contact any upstream account or relay service. Operators must manage database access, backups and their retention separately.
