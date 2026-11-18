# Connection identity audit

StartupBot owns the display metadata it sends for new connections. This includes MCP dynamic client registration and initialization; ChatGPT agent name hints; Codex initialization, identity/model probes; ACP browser login, turns, model discovery, background text, DeepSeek, Muse, Pi and supported Antigravity client names; Composio grant editing; browser, linked-computer and shared-desktop MCP clients; and the MCP server descriptions for agents, phone, connectors and permissions. Retired names are checked by the focused connection-metadata guard as well as runtime protocol tests.

New Composio identities use the startupbot_ prefix. Existing saved user IDs, connected accounts and tokens are retained; optional earlier-installation recovery recognizes both generations and refuses ambiguity. This avoids duplicating or losing grants just to rename a persisted identifier.

Vendor product names remain accurate. Old Antigravity runtimes requiring a vendor compatibility client name retain that external protocol requirement; supported open client identification uses startupbot. Protocol health/Bonjour/HPKE identifiers, MCP mount/tool namespaces, configured custom client IDs, environment-variable aliases and license attribution are compatibility contracts, not new product marketing names.

External OAuth consent is partly owned by the provider's registration. Code cannot rename an already registered third-party OAuth application or a user's previously chosen agent name. A StartupBot-owned Google/Microsoft/etc registration, client credentials, verified domain and provider approval must be supplied where required. Do not reuse an upstream private client secret or silently revoke working accounts. API key/local-model and synthetic OAuth tests do not prove real provider consent branding; each live consent screen remains NOT RUN until its owned configuration is available.

No cloud service is provisioned or enabled by this audit. No updater source is returned to upstream. No credentials are embedded in these reports.
