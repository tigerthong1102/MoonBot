import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createBotIdentityStore } from "./bot-identity-store.mjs";

const encryption = { available: async () => true, encrypt: async text => Buffer.from(`fixture:${text}`), decrypt: async bytes => bytes.toString().slice("fixture:".length) };

test("keeps a bot identity stable, signs the scoped claim and fails closed if its key is missing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-identity-fixture-"));
  try {
    const first = createBotIdentityStore({ directory, encryption });
    const identity = await first.identity("bot-fixture", { kind: "new" });
    const second = createBotIdentityStore({ directory, encryption });
    assert.deepEqual(await second.identity("bot-fixture", { kind: "existing", username: identity.username }), identity);
    const claim = { origin: "https://inbox.example.test", owner: "owner", bot: "bot", room: "room", nonce: "nonce" };
    const proof = await second.signClaim("bot-fixture", { kind: "existing", username: identity.username }, claim);
    const publicKey = createPublicKey({ key: Buffer.from(`302a300506032b6570032100${identity.publicKey}`, "hex"), format: "der", type: "spki" });
    const payload = Buffer.from(JSON.stringify(["startupbot-inbox-bot-claim-v1", ...Object.values(claim)]));
    assert.equal(verify(null, payload, publicKey, Buffer.from(proof.signature, "hex")), true);
    const mutableState = { kind: "existing", username: identity.username };
    const pending = second.signClaim("bot-fixture", mutableState, claim);
    claim.owner = "changed";
    mutableState.username = `bot_k${"0".repeat(64)}`;
    const snapshotProof = await pending;
    assert.equal(verify(null, payload, publicKey, Buffer.from(snapshotProof.signature, "hex")), true);
    const changedPayload = Buffer.from(JSON.stringify(["startupbot-inbox-bot-claim-v1", ...Object.values(claim)]));
    assert.equal(verify(null, changedPayload, publicKey, Buffer.from(snapshotProof.signature, "hex")), false);
    const keyFile = join(directory, readdirSync(directory).find(name => name.endsWith(".enc")));
    if (process.platform !== "win32") assert.equal(statSync(keyFile).mode & 0o777, 0o600);
    unlinkSync(keyFile);
    await assert.rejects(second.identity("bot-fixture", { kind: "existing", username: identity.username }), /missing/);
    assert.equal(readdirSync(directory).some(name => name.endsWith(".enc")), false);
    unlinkSync(join(directory, readdirSync(directory).find(name => name.endsWith(".public.json"))));
    await assert.rejects(second.identity("bot-fixture", { kind: "existing", username: identity.username }), /missing/);
    await assert.rejects(second.identity("bot-fixture"), /state is unavailable/);
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("separate processes publish only one complete key for the same bot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-identity-fixture-"));
  try {
    const moduleUrl = new URL("./bot-identity-store.mjs", import.meta.url).href;
    const script = `import { createBotIdentityStore } from ${JSON.stringify(moduleUrl)}; const encryption={available:async()=>true,encrypt:async text=>Buffer.from('fixture:'+text),decrypt:async bytes=>bytes.toString().slice(8)}; const store=createBotIdentityStore({directory:process.argv[1],encryption}); process.stdout.write((await store.identity('fixture',{kind:'new'})).username);`;
    const exec = promisify(execFile);
    const [a, b] = await Promise.all([exec(process.execPath, ["--input-type=module", "-e", script, directory]), exec(process.execPath, ["--input-type=module", "-e", script, directory])]);
    assert.equal(a.stdout, b.stdout);
    assert.match(a.stdout, /^bot_k[0-9a-f]{64}$/);
    assert.equal(readdirSync(directory).filter(name => name.endsWith(".enc")).length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("does not silently rotate an unreadable identity or an unavailable OS store", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-identity-fixture-"));
  try {
    const store = createBotIdentityStore({ directory, encryption });
    const identity = await store.identity("fixture", { kind: "new" });
    const keyFile = join(directory, readdirSync(directory).find(name => name.endsWith(".enc")));
    writeFileSync(keyFile, "broken-fixture");
    await assert.rejects(store.identity("fixture", { kind: "existing", username: identity.username }));
    assert.equal(readFileSync(keyFile, "utf8"), "broken-fixture");
    const offline = createBotIdentityStore({ directory, encryption: { ...encryption, available: async () => false } });
    await assert.rejects(offline.identity("fixture", { kind: "existing", username: identity.username }), /unavailable/);
    assert.equal(readFileSync(keyFile, "utf8"), "broken-fixture");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("concurrent creation for one bot returns one identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-identity-fixture-"));
  try {
    const a = createBotIdentityStore({ directory, encryption }), b = createBotIdentityStore({ directory, encryption });
    const [first, second] = await Promise.all([a.identity("fixture", { kind: "new" }), b.identity("fixture", { kind: "new" })]);
    assert.deepEqual(first, second);
    assert.notEqual((await a.identity("another-bot", { kind: "new" })).username, first.username);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
