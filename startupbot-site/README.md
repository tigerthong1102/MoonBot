# StartupBot website

Build the static site with `node startupbot-site/build.mjs`. The default output
in `dist/` contains no installer links. Serve it from the root of any domain.

For an owner preview with GitHub Actions links, pass `--artifacts`. The
download catalog lists the build architecture, artifact URL, expiry and SHA-256.
GitHub downloads require an account with access to the repository.

For a loopback preview with direct downloads, pass `--installers /path/to/files`.
Only catalogued files with matching SHA-256 digests enter `dist-internal/`.
Serve that directory on 127.0.0.1. Keep installer binaries outside Git.

For the public preview, run `node build.mjs --direct && node compile-worker.mjs`
from this directory. The Sites project needs its own `.openai/hosting.json`
with the managed object store bound as `BUCKET`. Store each approved installer
under its SHA-256 digest and check its size and digest before enabling the link.
The website streams catalogued files at `/files/<filename>` and supports HTTP
byte ranges for resumable downloads. The deployed worker is read-only.

Add a translation in `locales/<language>.json` using the same keys as the
Vietnamese catalog. The build generates routes and language choices from these
files. Vietnamese lives at the root, English at `/en/`, and new languages get
their own prefix. Domains are independent of the build.

Run `node --test startupbot-site/site.test.mjs` to check the locale, link and
build contracts.

The no-install browser app is at `/app/` and `/en/app/`. The local chat loads
the pinned Qwen2.5-0.5B-Instruct Q4_K_M GGUF only after consent, verifies its
SHA-256, and uses a single-thread WebAssembly worker. Browser Cache Storage
holds the model when space is available. Chat history lives in tab memory.
Users can also navigate to their own HTTPS StartupBot host for agent tools.

The browser runtime files under `web/runtime-2.3.7` come from the published
`@wllama/wllama@2.3.7` npm package (`esm/index.min.js` and
`esm/single-thread/wllama.wasm`). Third-party notices are in `web/notices.txt`.

A workspace invitation opens directly on its own server. Saving an address is
opt-in and retains only the origin. An explicit HTTP loopback URL is supported
for a workspace on the same device. Local chat offers a 1.5B or 0.5B Qwen model,
streams SHA-256 verification with hash-wasm 4.12.0, and reuses matching prompt
tokens between turns. Text attachments and transcript exports stay on the device.
The decimal arithmetic tool is also available before a model is loaded.

“Save a local copy” stores an explicit snapshot in this browser. Saved copies
can be reopened before loading a model or deleted in the app. Reloading a tab
discards unsaved chat messages. Pairing codes are never included in saved hosts.

Optional quick chat at `/app/chat/` and `/en/app/chat/` renders HTML forms on the Sites Worker. OpenRouter PKCE grants each visitor a separate connection; only
`openrouter/free` is requested, with maximum prompt and output prices of zero.
Set the Sites secret `STARTUPBOT_WEB_SESSION_KEY` to a random 32-byte
base64url value. Rotating it ends existing sessions. Browser-model and private
workspace options live at `/app/local/` and `/en/app/local/`.

## Browser workspaces

The portal at `/app/` uses the Sites identity headers provided after top-level sign-in. Run it only behind the trusted Sites dispatch. The verified site-scoped account ID, visible on the signed-in page, selects one dedicated workspace origin. Email and URL parameters cannot select a workspace.

Provision one isolated StartupBot OSS instance for each account with a dedicated HTTPS origin, private persistent data and network isolation. The HTTPS proxy must overwrite forwarding headers so anonymous internet requests cannot receive loopback-owner access. Keep host volumes, management sockets, private services and other tenant networks inaccessible to agents. Provisioning is manual in this preview.

On that isolated runtime, create a revocable automation token with `token create site-launch --scope admin --expires 7d --out /private/path/launch-token` using its own CLI. The native pairing endpoint requires the admin scope. Put a JSON array of records with fields `id`, `origin` and `token` in the Sites runtime secret `STARTUPBOT_WEB_WORKSPACES`. Omit trailing slashes from origins. Rotate the token before its expiry. The default empty list admits nobody.

Opening a workspace asks its server for a one-minute invitation. The browser confirms the native pairing form and receives its own session, limited to eight hours. The portal cannot inspect chats or provider keys through the web UI. On shared devices, sign out from both the workspace and the portal. To remove access, remove the assignment, revoke the launch token and existing device sessions in the workspace.

Run `node --test *.test.mjs` for the site and gateway. For isolated browser verification set `STARTUPBOT_REPO` to the product checkout, `STARTUPBOT_UI` to its built renderer, and optionally `STARTUPBOT_PLAYWRIGHT` to a Playwright module path. Run `node verification/workspace-browser.mjs` with Chrome and OpenSSL installed. The fixture simulates the Sites identity boundary, uses real native pairing, and removes its temporary servers. With `STARTUPBOT_FIXTURE_MODEL` set to an installed Ollama model, it also checks an actual model reply. Public identity-provider login and hosted tenant provisioning need separate deployment verification.

On a Mac with the internal StartupBot app installed, `scripts/open-mac-workspace.command` opens a separate local browser workspace. It runs the packaged backend on 127.0.0.1:18868 and keeps its data under `~/Library/Application Support/StartupBot Web Preview/`. Open the command again to get a fresh invitation. The default browser stores its paired session. Quit the preview server with `launchctl remove ai.startupbot.web-preview.local`; reopening the command starts it again with the same data. This macOS preview requires Node on PATH or in /opt/homebrew/bin. Select an AI provider inside the workspace.
