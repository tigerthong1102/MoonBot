# Personal Microsoft Teams bridge

The self-hosted receiver loads the MIT-licensed Teams adapter from Nous Research's [Hermes Agent revision ab7e19a7](https://github.com/NousResearch/hermes-agent/tree/ab7e19a761e0ef52ef0d1c5f0417c5784c653446/plugins/platforms/teams). The adapter uses Microsoft's Teams SDK for authenticated activities, attachment retrieval and Teams text replies. StartupBot owns the sender grants and confined conversation mapping.

Use the StartupBot server version with the confined-key request header and enable Bot API for the intended bot. Register the single-tenant Teams bot for personal scope, enable file support in its manifest, and point its HTTPS messaging endpoint at the receiver's `/api/messages`. Run one receiver process per credentials/database pair behind TLS. Keep its grants, SQLite database and Hermes cache in a directory accessible only to the service account.

Install the pinned source into a separate Python 3.13 environment:

```sh
git clone https://github.com/NousResearch/hermes-agent.git hermes-teams-adapter
git -C hermes-teams-adapter checkout --detach ab7e19a761e0ef52ef0d1c5f0417c5784c653446
uv venv --python 3.13 .teams-venv
uv pip install --python .teams-venv/bin/python -e './hermes-teams-adapter[teams]' \
  python-dotenv==1.2.4 PyYAML==6.0.4 'httpx[socks]==0.28.1' requests==2.34.2 rich==14.3.4 ruamel.yaml==0.18.16
```

Set `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET`, `TEAMS_TENANT_ID`, `TEAMS_HOST` (for example `127.0.0.1`), `TEAMS_PORT`, `HERMES_HOME`, `STARTUPBOT_TEAMS_DB` and `STARTUPBOT_TEAMS_GRANTS`. Point the last variable at a JSON file using Azure AD object IDs, one explicitly enrolled sender per entry. Each sender receives their own conversation per personal chat, bot, key and grant generation.

```json
{"senders":{"aad-object-id":{"endpoint":"https://your.domain/hooks/api/bots/your-bot/messages","key_env":"FINANCE_BOT_KEY","grant_id":"unique-enrollment-id"}}}
```

Set the named key in the service environment and launch `.teams-venv/bin/python deploy/teams/bridge.py` from StartupBot. `GET /health` checks the listener. A sender can send text and up to three UTF-8 TXT, Markdown or CSV documents (16 KB each, 20,000 characters total). Use `/status` to read a pending reply and `/new` to open a fresh thread on the next message. Approvals happen in StartupBot. Documents in other formats receive a format notice.

Remove an entry by atomically replacing the grants file to revoke that sender, including outstanding reply reads. Use a fresh grant ID on reenrollment. Rotating or disabling the bot key also revokes access. The local ledger stores hashed conversation scopes, Teams activity IDs, StartupBot thread IDs and completion state; the Hermes media cache holds downloaded files and belongs under the site's normal retention policy. Check the local StartupBot thread before repeating a request whose delivery was uncertain.
