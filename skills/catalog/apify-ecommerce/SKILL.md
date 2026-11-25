---
name: apify-ecommerce
description: "Research product listings and reviews using approved Apify sources"
license: Apache-2.0
---

**StartupBot adaptation, 2026-11-19.** Source and changes are recorded in SOURCE.md.

Use the workspace and tools already configured for this task. Treat upstream examples as examples. Ask before installing software, changing permissions, spending money, or sending files or messages to a third party. Use credentials from the configured connector or protected environment. Keep private data and keys out of output, commands that log secrets, and sample files. Do not run updater or telemetry instructions from a reference. When a required tool is unavailable, report what is missing and continue with the authorized input already provided.


The original guide is preserved in `references/upstream.md` for feature comparison. It may describe tools or setup unavailable here; verify compatibility and authorization before acting. Do not automatically install, create credentials, upload, change settings or spend money.

# Research product listings and reviews using approved Apify sources

Use a configured read-only connection and public or authorized sources. Collect the requested fields only. Record listing URL, currency, displayed price and date. Separate shipping, VAT and promotions. Summarize review patterns without customer identifiers.

## Research workflow

Identify the marketplace, search term or public product URL, desired fields, country and result limit. Discover available Apify Actors with the configured Apify connection and inspect their input schema, pricing and documented coverage before choosing one. The public discovery tools can list Actors and documentation without account access. Running an Actor needs an authorized Apify account and may consume its credits or incur charges. Confirm the intended budget before a paid run and apply a maximum charge if the service supports it.

Begin with a small sample. Request product names, source URLs, observed prices, currency, availability and timestamps when available. Wait for the run to complete and inspect the resulting dataset; a successful run can still return no products or incomplete fields. Distinguish missing values from zero, preserve marketplace and seller context, and state the observation time and limitations. For comparisons, normalize currency only when a conversion rate and its date are available, and keep shipping, promotions and taxes separate when the source permits.

The official remote Apify MCP server supports public discovery and OAuth for authenticated account access. Use an existing configured connection; if it is absent, explain what connection is needed. Never put an API token into a chat message or a URL. The user should authorize access through the app's connection flow.
