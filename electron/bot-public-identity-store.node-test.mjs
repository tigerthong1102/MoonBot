import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBotPublicIdentityStore } from "./bot-public-identity-store.mjs";

const scope = { workspaceId: "workspace-fixture", localBotId: "bot-fixture" };
const makeIdentity = byte => {
  const publicKey = byte.repeat(64);
  return { publicKey, username: `bot_k${createHash("sha256").update(Buffer.from(publicKey, "hex")).digest("hex")}` };
};

test("keeps a committed public identity and rejects identity changes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-public-id-fixture-"));
  try {
    const store = createBotPublicIdentityStore({ directory, workspaceId: scope.workspaceId, current: () => true });
    const first = makeIdentity("a");
    assert.deepEqual(await store.load(scope), { kind: "new" });
    assert.deepEqual(await store.commit(scope, { kind: "new" }, first), { kind: "existing", username: first.username });
    assert.deepEqual(await store.load(scope), { kind: "existing", username: first.username });
    await assert.rejects(store.commit(scope, { kind: "new" }, makeIdentity("b")), /identity_changed/);
    unlinkSync(join(directory, readdirSync(directory)[0]));
    await assert.rejects(store.commit(scope, { kind: "existing", username: first.username }, first), /missing/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("refuses a workspace switch and malformed records without overwriting", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-public-id-fixture-"));
  try {
    let current = true;
    const store = createBotPublicIdentityStore({ directory, workspaceId: scope.workspaceId, current: () => current });
    current = false;
    await assert.rejects(store.commit(scope, { kind: "new" }, makeIdentity("a")), /target_changed/);
    current = true;
    await store.commit(scope, { kind: "new" }, makeIdentity("a"));
    const file = join(directory, readdirSync(directory)[0]);
    writeFileSync(file, "broken fixture");
    await assert.rejects(store.load(scope));
    await assert.rejects(store.commit(scope, { kind: "new" }, makeIdentity("b")));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("rejects an asynchronous workspace predicate instead of accepting its Promise", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-public-id-fixture-"));
  try {
    const store = createBotPublicIdentityStore({ directory, workspaceId: scope.workspaceId, current: async () => false });
    await assert.rejects(store.commit(scope, { kind: "new" }, makeIdentity("a")), /target_changed/);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("competing identity stores cannot claim the same bot with different keys", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-public-id-fixture-"));
  try {
    const a = createBotPublicIdentityStore({ directory, workspaceId: scope.workspaceId, current: () => true });
    const b = createBotPublicIdentityStore({ directory, workspaceId: scope.workspaceId, current: () => true });
    const [first, second] = await Promise.all([a.load(scope), b.load(scope)]);
    const results = await Promise.allSettled([a.commit(scope, first, makeIdentity("a")), b.commit(scope, second, makeIdentity("b"))]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.equal(readdirSync(directory).length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("registration uses the actual fixture stores and refuses to replace a missing private key", async () => {
  const { createBotIdentityStore } = await import("./bot-identity-store.mjs");
  const { createBotIdentityRegistration } = await import("./bot-identity-registration.mjs");
  const root = mkdtempSync(join(tmpdir(), "startupbot-store-integration-fixture-"));
  try {
    const publicStore = createBotPublicIdentityStore({ directory: join(root, "public"), workspaceId: scope.workspaceId, current: candidate => candidate.workspaceId === scope.workspaceId });
    const encryption = { available: async () => true, encrypt: async text => Buffer.from(`fixture:${text}`), decrypt: async bytes => bytes.toString().slice(8) };
    const privateDir = join(root, "private"), privateStore = createBotIdentityStore({ directory: privateDir, encryption });
    let sent = 0;
    const input = { ...scope, bindingId: "11111111-1111-4111-8111-111111111111", room: "22222222-2222-4222-8222-222222222222", owner: "fixture-owner", origin: "https://fixture.invalid", name: "Fixture" };
    const registration = createBotIdentityRegistration({ identityStoreFor: async () => privateStore, loadIdentity: publicStore.load, commitIdentity: publicStore.commit,
      currentAccount: async () => input.owner, validateTarget: async candidate => candidate.workspaceId === scope.workspaceId,
      challenge: async () => ({ nonce: "33333333-3333-4333-8333-333333333333" }), invite: async () => { sent++; },
    });
    const result = await registration.register(input);
    assert.equal((await publicStore.load(scope)).username, result.username);
    unlinkSync(join(privateDir, readdirSync(privateDir).find(name => name.endsWith(".enc"))));
    await assert.rejects(registration.register(input), /missing/);
    assert.equal(sent, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("different processes cannot publish competing public keys for one bot", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const directory = mkdtempSync(join(tmpdir(), "startupbot-public-id-process-fixture-"));
  try {
    const moduleUrl = new URL("./bot-public-identity-store.mjs", import.meta.url).href;
    const script = `import { createHash } from 'node:crypto'; import { createBotPublicIdentityStore } from ${JSON.stringify(moduleUrl)}; const scope={workspaceId:'workspace-fixture',localBotId:'bot-fixture'}; const store=createBotPublicIdentityStore({directory:process.argv[1],workspaceId:scope.workspaceId,current:()=>true}); const publicKey=process.argv[2].repeat(64); const identity={publicKey,username:'bot_k'+createHash('sha256').update(Buffer.from(publicKey,'hex')).digest('hex')}; try { const old=await store.load(scope); await store.commit(scope,old,identity); process.stdout.write('ok'); } catch { process.stdout.write('rejected'); }`;
    const exec = promisify(execFile);
    const [a, b] = await Promise.all([exec(process.execPath, ["--input-type=module", "-e", script, directory, "a"]), exec(process.execPath, ["--input-type=module", "-e", script, directory, "b"])]);
    assert.deepEqual([a.stdout, b.stdout].sort(), ["ok", "rejected"]);
    assert.equal(readdirSync(directory).length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("identical bot ids in different workspaces have distinct public records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-public-id-workspaces-fixture-"));
  try {
    const other = { ...scope, workspaceId: "another-workspace" };
    const a = createBotPublicIdentityStore({ directory, workspaceId: scope.workspaceId, current: () => true });
    const b = createBotPublicIdentityStore({ directory, workspaceId: other.workspaceId, current: () => true });
    const first = makeIdentity("a"), second = makeIdentity("b");
    await a.commit(scope, { kind: "new" }, first);
    assert.deepEqual(await b.load(other), { kind: "new" });
    await b.commit(other, { kind: "new" }, second);
    assert.equal((await a.load(scope)).username, first.username);
    assert.equal((await b.load(other)).username, second.username);
    assert.equal(readdirSync(directory).length, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
