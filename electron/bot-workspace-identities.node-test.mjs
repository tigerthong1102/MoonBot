import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBotWorkspaceIdentities } from "./bot-workspace-identities.mjs";

const encryption = { available: async () => true, encrypt: async text => Buffer.from(`fixture:${text}`), decrypt: async bytes => bytes.toString().slice(8) };

test("isolates identical bot ids in different workspaces", async () => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-workspace-identity-fixture-"));
  try {
    const options = { publicDirectory: join(root, "public"), privateDirectory: join(root, "private"), encryption, current: () => true };
    const a = createBotWorkspaceIdentities({ ...options, workspaceId: "workspace-a" });
    const b = createBotWorkspaceIdentities({ ...options, workspaceId: "workspace-b" });
    const aScope = { workspaceId: "workspace-a", localBotId: "same-bot" }, bScope = { ...aScope, workspaceId: "workspace-b" };
    const aPrivate = await a.identityStoreFor(aScope), bPrivate = await b.identityStoreFor(bScope);
    const first = await aPrivate.identity(aScope.localBotId, await a.loadIdentity(aScope));
    const second = await bPrivate.identity(bScope.localBotId, await b.loadIdentity(bScope));
    assert.notEqual(first.username, second.username);
    await a.commitIdentity(aScope, { kind: "new" }, first);
    await b.commitIdentity(bScope, { kind: "new" }, second);
    assert.equal((await a.loadIdentity(aScope)).username, first.username);
    assert.equal((await b.loadIdentity(bScope)).username, second.username);
    await assert.rejects(a.identityStoreFor(bScope), /target_changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("isolates distinct malformed Unicode workspace ids", async () => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-workspace-unicode-fixture-"));
  try {
    const options = { publicDirectory: join(root, "public"), privateDirectory: join(root, "private"), encryption, current: () => true };
    const a = createBotWorkspaceIdentities({ ...options, workspaceId: "x\ud800" });
    const b = createBotWorkspaceIdentities({ ...options, workspaceId: "x\ud801" });
    const aScope = { workspaceId: "x\ud800", localBotId: "same-bot" }, bScope = { ...aScope, workspaceId: "x\ud801" };
    const first = await (await a.identityStoreFor(aScope)).identity(aScope.localBotId, { kind: "new" });
    const second = await (await b.identityStoreFor(bScope)).identity(bScope.localBotId, { kind: "new" });
    assert.notEqual(first.username, second.username);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("isolates distinct malformed Unicode bot ids", async () => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-bot-unicode-fixture-"));
  try {
    const identities = createBotWorkspaceIdentities({ publicDirectory: join(root, "public"), privateDirectory: join(root, "private"), workspaceId: "fixture", encryption, current: () => true });
    const store = await identities.identityStoreFor({ workspaceId: "fixture", localBotId: "x\ud800" });
    const first = await store.identity("x\ud800", { kind: "new" });
    const second = await store.identity("x\ud801", { kind: "new" });
    assert.notEqual(first.username, second.username);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
