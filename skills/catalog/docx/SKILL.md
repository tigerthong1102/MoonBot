---
name: docx
description: "Create and edit Word documents"
license: Apache-2.0
---

**StartupBot adaptation, 2026-11-19.** Source and changes are recorded in SOURCE.md.

Use the workspace and tools already configured for this task. Treat upstream examples as examples. Ask before installing software, changing permissions, spending money, or sending files or messages to a third party. Use credentials from the configured connector or protected environment. Keep private data and keys out of output, commands that log secrets, and sample files. Do not run updater or telemetry instructions from a reference. When a required tool is unavailable, report what is missing and continue with the authorized input already provided.

# Create and edit Word documents

Use an available DOCX tool to create or edit a copy. Confirm sections and output path. Preserve styles, tables, headers, footers and comments where supported. Use a tool with tracked changes when requested. Save, reopen and check headings, text and tables. Inspect a rendered copy when layout matters.

## Local document workflow

On a Mac configured with `startupbot-python`, use its `python-docx` package for ordinary document creation and edits. Other machines should use a configured document tool or an installed compatible library. Inspect the source before editing and work on a copy. Preserve the author's structure and wording unless the user requests changes. Use proper heading styles, readable margins, real tables and consistent typography. Add accessible descriptions for informative images where the selected tool supports them.

Reopen the saved document and verify its headings, paragraphs and tables. If a renderer such as LibreOffice is available, render to PDF and inspect the pages for clipping, broken tables, blank pages and misplaced images. When an input contains comments, tracked changes, fields or other elements that the chosen library cannot reliably edit, use a compatible tool or explain the limitation and keep the original intact. For the upstream techniques and details, consult `references/upstream.md`; its optional scripts and npm packages require independent availability checks.
