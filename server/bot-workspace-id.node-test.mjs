import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBotWorkspaceIdStore } from "./bot-workspace-id.mjs";

test("keeps a new workspace identity on restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-workspace-id-fixture-"));
  try {
    const first = createBotWorkspaceIdStore({ directory, acquireOwnerGuard: () => ({ held: true, release: () => {} }), hasAnchoredBots: () => false }).loadOrCreate();
    const reopened = createBotWorkspaceIdStore({ directory, acquireOwnerGuard: () => ({ held: true, release: () => {} }), hasAnchoredBots: () => true }).loadOrCreate();
    assert.equal(reopened, first);
    assert.match(first, /^[\da-f-]{36}$/i);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("normalizes an existing UUID so casing cannot change the workspace namespace", () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-workspace-id-fixture-"));
  try {
    const id = "aabbccdd-1111-4111-8111-aabbccddeeff";
    writeFileSync(join(directory, "bot-workspace-identity.json"), JSON.stringify({ version: 1, id: id.toUpperCase() }));
    const store = createBotWorkspaceIdStore({ directory, acquireOwnerGuard: () => ({ held: true, release: () => {} }), hasAnchoredBots: () => true });
    assert.equal(store.loadOrCreate(), id);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("does not replace a missing or corrupt workspace identity when bots are anchored", () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-workspace-id-fixture-"));
  try {
    const store = createBotWorkspaceIdStore({ directory, acquireOwnerGuard: () => ({ held: true, release: () => {} }), hasAnchoredBots: () => true });
    assert.throws(() => store.loadOrCreate(), /restore/);
    assert.deepEqual(readdirSync(directory), []);
    const file = join(directory, "bot-workspace-identity.json");
    writeFileSync(file, "broken fixture");
    assert.throws(() => store.loadOrCreate());
    assert.equal(readFileSync(file, "utf8"), "broken fixture");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("refuses an unknown or asynchronous anchor state", () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-workspace-id-fixture-"));
  try {
    assert.throws(() => createBotWorkspaceIdStore({ directory, acquireOwnerGuard: () => ({ held: true, release: () => {} }), hasAnchoredBots: () => undefined }).loadOrCreate(), /restore/);
    assert.throws(() => createBotWorkspaceIdStore({ directory, acquireOwnerGuard: () => ({ held: true, release: () => {} }), hasAnchoredBots: async () => false }).loadOrCreate(), /restore/);
    assert.throws(() => createBotWorkspaceIdStore({ directory, acquireOwnerGuard: () => ({ held: true, release: () => {} }), hasAnchoredBots: async () => { throw new Error("fixture"); } }).loadOrCreate(), /restore/);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("requires a synchronous owner guard", () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-workspace-id-fixture-"));
  try {
    assert.throws(() => createBotWorkspaceIdStore({ directory, hasAnchoredBots: () => false }).loadOrCreate(), /guard/);
    assert.throws(() => createBotWorkspaceIdStore({ directory, hasAnchoredBots: () => false, acquireOwnerGuard: async () => ({ held: true, release: () => {} }) }).loadOrCreate(), /guard/);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("rejects an asynchronous guard release rather than reporting success", () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-workspace-id-fixture-"));
  try {
    const store = createBotWorkspaceIdStore({ directory, hasAnchoredBots: () => false, acquireOwnerGuard: () => ({ held: true, release: async () => {} }) });
    assert.throws(() => store.loadOrCreate(), /synchronously/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
