# The Inbox on every plan

`server/place-inbox.e2e.test.ts` boots this computer's server and My Cloud's with the synthetic Claude CLI, and on each:

1. An empty inbox answers with no rows, not 404.
2. A bot's approval and question, in two threads at once, are listed with count 2, each labelled with its thread.
3. An answer through the row's own conversation reaches the bot, its turn goes on and the count clears. A second answer to
   the same card is refused.
4. `message_person` arrives as one line, one row and one notification, and a reply reaches the bot.
5. A question left by `NEEDS INPUT:` that the person writes past leaves Needs you and stops marking the thread as
   waiting on the person; its card stays open to answer.

On My Cloud it also checks that nobody connects as a guest, that a bot's shell reads nothing, and that a guest's conversation
left behind reaches the owner labelled, with its news kept away.

```sh
pnpm exec vitest run server/place-inbox.e2e.test.ts
```

## The panel

`src/components/inbox/InboxReading.dom.test.ts` drives the panel as a tab: its count and close, three-line rows with a
question's choices and the recommended one marked, the search, a line read in full with "n of m" and its steps, the bot's
words before it drawn as the chat's Markdown, and a question answered with its choice cards, a number key and a note through
`/api/threads/<id>/respond`, after which the next line opens, or the list when none is left. A password or a sign-in is keyed
by its own card kind and answered with the chat's own card for it.

```sh
pnpm exec vitest run src/components/inbox/InboxReading.dom.test.ts src/components/inbox/InboxPanel.dom.test.ts src/components/inbox/InboxEverywhere.dom.test.ts
```

## The rail, in a real build

`scripts/verify-place-inbox-rail.mjs` runs the packaged app, production main process and all, on a GitHub macOS runner
(the `inbox-rail-check.yml` workflow, which lives only on the `ci/inbox-rail-check` branch and runs on a push there or by hand). It refuses to run anywhere else,
because it edits `/etc/hosts` and trusts a throwaway certificate. A synthetic Admin and synthetic Clouds answer at their real
addresses over real TLS, and a bot on the synthetic Claude CLI asks a real question on the real local server.

1. The app signs in, and the rail lists this computer and both Clouds.
2. A Cloud never opened on this computer is asked in the background, with the session the app paired by itself. Nothing waits,
   so its tile stays quiet.
3. Lines waiting there fire "{name}: needs you" and the dot. The dot is gone while that place is on screen, and back on leaving.
4. Once the Admin says a Cloud sleeps it is not asked over a whole poll, and it keeps its last number. Awake again with nothing
   waiting, its label and dot clear.
5. A Cloud asleep from the start receives no request in the whole run.
6. While the window shows a Cloud, this computer's tile fires for the question on the local server.

It proves the app's side of the Admin's word. It has not run against a real Cloud, a real sleep or a real wake. The watch's
own rules are in `electron/place-inbox-watch.node-test.mjs`.

### Verify a temporary Twin key

In a local desktop with an active Twin, open AI Twin settings and get a desktop code. Sign in to the same Inbox account in a separate browser. Open the pairing panel there, enter the code and compare the complete fingerprint with the desktop. Confirm on the desktop and then in the browser. Another signed-in device can revoke the record.

This workflow verifies possession of a temporary key and records two confirmations under different Inbox sessions. The app keeps its private key in memory. The Worker record expires after at most ten minutes, and signing out either participating session removes it. A network interruption can leave the remote record visible until expiry or an acknowledged revocation. An already confirmed record does not attest that the desktop is still running. It grants no read, provider or send permission and does not establish ownership of a previously known workspace ID. The desktop must be online to offer and sign the key. After it signs, the browser can confirm before expiry even if the desktop disconnects.

Run these commands from the repository root with the workspace dependencies, OpenSSL and an Electron runtime installed. Set `PAIR_FIXTURE_ELECTRON` to the runtime executable if using a separate Electron distribution.

```sh
node cloudflare/control-plane/inbox/prepare-assets.mjs
node --experimental-strip-types scripts/verify-twin-inbox-pairing.mjs
```

The fixture creates a local Twin and runs the Inbox Worker and D1 locally. It logs in through the OTP API using an in-memory mailbox, then places those session cookies into separate Electron partitions. It mounts the desktop pairing component with the production preload and IPC and exercises the Inbox web UI in two other windows in the same Electron process. It completes browser confirmation and independently reads back revocation from the third session.

The fixture intercepts the native dialog call, checks the fingerprint and default Cancel button in its arguments and returns a scripted approval. It does not display the OS dialog. Human comparison, separate physical devices, hosted services and installed application packages require separate verification.

### Automatic replies to an owner-taught question

Run the same isolated fixture with its experimental exact-answer gate enabled.

```sh
node cloudflare/control-plane/inbox/prepare-assets.mjs
node --experimental-strip-types scripts/verify-twin-inbox-pairing.mjs --exact
node --test electron/twin-online-exact.node-test.mjs
pnpm exec vitest run --root cloudflare/control-plane --config vitest.config.ts "$(pwd)/cloudflare/control-plane/test/personal-inbox.test.ts"
```

The desktop component chooses an owner-taught lesson from a temporary local workspace and one DM. The fixture checks native-dialog arguments and supplies a scripted approval without opening an OS dialog. A second Inbox session reviews the actual question, answer, expiry and room. A peer posts a matching message. The desktop polls the local Worker, signs a short-lived request, and the Worker stores one attributed reply. A third session revokes the grant and the fixture checks another matching message produces no reply. The three windows share one Electron process. This recipe runs against source and an unpackaged Electron runtime.

The feature is off unless the isolated Worker receives `INBOX_EXACT_ANSWER=1`. The Inbox owner authorizes the paired public key. Inbox records this account's consent and the signature for each reply. It cannot attest a desktop installation, a workspace identity or one human controlling both sessions. The exact question and answer go to Inbox for review. Inbox deletes that copy on revocation or during daily cleanup after expiry. The signed receipt contains identifiers, origin, deadline and public key. It follows its source message through the 30-day retention period and daily cleanup. Deleting the source deletes its receipt. Posted replies have their own message lifecycle. No model receives messages or generates answers. The grant ends within ten minutes and allows twenty replies at most. The text comparison is exact. The selected rooms use a membership incarnation. Choosing all rooms explicitly includes future DMs and groups. Final posting rechecks central permission, membership, the source message and expiry.

Stopping the signer on the desktop prevents new signatures. An already signed request can finish within four seconds while central revocation is pending. Successful central revocation prevents further posting immediately. After a disconnect or restart, opening the desktop pairing panel checks the account and reconciles pending revocations. A journal stores identifiers on disk. The private key exists only in memory. Windows and Linux package behavior and abrupt power loss require separate validation.

### Generated replies while the desktop is online

Generated replies have a separate Worker gate, `INBOX_GENERATED_ANSWER=1`, and start off. In AI Twin settings the owner can select one to eight current rooms or include all accepted direct conversations, all groups they own or manage, or both. The broad settings explicitly include future rooms. The desktop and a second signed-in Inbox session confirm the model, provider destination, rooms, expiry and attempt limit. The room composer shows the provider notice before a participant types. Text sent by older clients or composed without that notice remains ordinary chat. The posted reply carries an AI-generated label.

A newly encountered room can use a broad permission after its first eligible sender opens the composer. D1 checks current membership and group management and binds a room to one provider. If multiple eligible owners have competing broad permissions in an unbound room, messages remain ordinary chat. A broad disclosure belongs to one sender and room. Losing access to manage a bound room ends the grant. The five-attempt limit is shared across every selected or future room.

The provider receives the current eligible text and a fixed instruction. The prompt excludes room history, attachments, learned lessons, tools and workspace files. Each grant permits five source attempts within ten minutes, one at a time. A claimed attempt counts even if a provider fails. Existing spending controls also apply. Actual charges depend on the provider. Worker authorization and the provider request run on separate systems. A revocation can race with a request the Worker has already admitted. The provider can still receive or charge for that attempt. Central revocation suppresses a subsequent post and leaves previously posted messages in their normal lifecycle.

Run the local fixture from the repository root:

```sh
node cloudflare/control-plane/inbox/prepare-assets.mjs
node --experimental-strip-types scripts/verify-twin-inbox-pairing.mjs --generated
node --experimental-strip-types scripts/verify-twin-inbox-pairing.mjs --generated-future
node --test electron/twin-online-generated.node-test.mjs
```

The fixture uses separate local Inbox sessions, an isolated Worker and D1, a synthetic HTTP provider, and the production Electron bridge. It inspects native dialog arguments and scripts approval. The future-room run creates its DM after both approvals. Each run sends a new DM question, checks the generated label and reply, revokes the grant, and counts provider requests. Hosted D1, live provider billing, installed packages and additional operating systems require separate verification.
