---
name: google-ads-api-mcp-setup
description: "Check a Google Ads MCP connection"
license: Apache-2.0
---

**StartupBot adaptation, 2026-11-19.** Source and changes are recorded in SOURCE.md.

Use the workspace and tools already configured for this task. Treat upstream examples as examples. Ask before installing software, changing permissions, spending money, or sending files or messages to a third party. Use credentials from the configured connector or protected environment. Keep private data and keys out of output, commands that log secrets, and sample files. Do not run updater or telemetry instructions from a reference. When a required tool is unavailable, report what is missing and continue with the authorized input already provided.


The original guide is preserved in `references/upstream.md` for feature comparison. It may describe tools or setup unavailable here; verify compatibility and authorization before acting. Do not automatically install, create credentials, upload, change settings or spend money.

# Check a Google Ads MCP connection

Confirm the account to read and its permissions. Configure a trusted Google Ads MCP server through StartupBot connector settings, with the least privilege required for the use case. Test account enumeration and a small read-only query. Report the exact account and expected fields returned.

For the upstream server's example read operations, field discovery and propose-and-confirm mutation flow, consult `references/tools.md`. Discover the tools and schemas exposed by the person's configured server first: names and supported operations can differ by version. Do not treat the reference as proof that a particular account, tool or write capability is available. Check the target and obtain authorization before any externally visible change.
