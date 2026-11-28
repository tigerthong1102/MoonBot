# Forget personal Second Brain pages

Open **Data → Second brain** in the same browser and workspace session that saved the page. **Forget this page** removes all locally saved versions of that page. **Forget all saved pages** includes pages you can no longer open, even when the list appears empty. Confirm the scope in the dialog. Original messages, document files and other owners’ pages have separate lifetimes.

Approval is append-only in this IndexedDB store. To keep an old editor from appending a deleted revision again, the erasure transaction replaces the page payloads with small records and reserves the next revision. They contain only a random page ID, version zero and an erasure flag. Keys still identify the storage owner and revision slots. A failed transaction retains the prior state. There is no Undo or content backup for this operation.

An updated tab rechecks the owner, source and latest page before exporting. Other open tabs receive a content-free invalidation. A sleeping Cloud stays asleep. An older already-open client can still export text it rendered before the change until it refreshes. Existing downloads, copies on other devices, user-managed browser-profile backups and physical recovery of browser files are outside the operation.

## Verification

With a supported Chrome runtime and the repository’s pinned agent-browser available, run:

```sh
OMB_UI_E2E=1 pnpm exec vitest run scripts/testing/brain-erasure-ui.e2e.test.ts
pnpm exec vitest run src/components/knowledge/brain-erasure.test.ts src/components/knowledge/brain.dom.test.ts src/components/knowledge/ZaloKnowledgeDraft.dom.test.ts
```

The browser fixture launches a disposable fake-engine workspace, uses two Chrome tabs on the same origin and reads the resulting IndexedDB rows. The source comes from an actual fixture conversation. Test data also includes an unavailable source and another storage owner. The separate unit tests exercise malformed owner responses, sleeping-Cloud invalidation and server denial. Full packaged and physical-device qualification is separate.
