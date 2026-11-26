import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createBotIdentityRegistration } from "./bot-identity-registration.mjs";

const input = { workspaceId: "workspace-fixture", localBotId: "bot-fixture", bindingId: "11111111-1111-4111-8111-111111111111", owner: "owner-fixture", room: "22222222-2222-4222-8222-222222222222", origin: "https://fixture.invalid", name: "Fixture bot" };
const publicKey = "b".repeat(64);
const identity = { username: `bot_k${createHash("sha256").update(Buffer.from(publicKey, "hex")).digest("hex")}`, publicKey };
function fixture() {
  let state = { kind: "new" }, account = input.owner, sent = 0, signGate;
  const calls = [];
  const identityStore = {
    identity: async () => identity,
    signClaim: async (_id, value, claim) => { calls.push({ value, claim }); if (signGate) await signGate; return { ...identity, signature: "c".repeat(128) }; },
  };
  const registration = createBotIdentityRegistration({ identityStoreFor: async () => identityStore,
    loadIdentity: async () => state,
    commitIdentity: async (_id, expected, proposed) => {
      if (expected.kind === "new" && state.kind === "new") state = { kind: "existing", username: proposed.username };
      return state;
    },
    currentAccount: async () => account, validateTarget: async () => true,
    challenge: async () => ({ nonce: "33333333-3333-4333-8333-333333333333" }),
    invite: async value => { sent++; calls.push(value); },
  });
  return { registration, calls, count: () => sent, switchAccount: () => { account = "other-fixture"; }, gate: promise => { signGate = promise; }, state: () => state };
}

test("persists the public identity before sending a context-bound claim", async () => {
  const f = fixture();
  assert.deepEqual(await f.registration.register(input), { username: identity.username });
  assert.deepEqual(f.state(), { kind: "existing", username: identity.username });
  assert.equal(f.count(), 1);
  assert.deepEqual(f.calls[0].claim, { origin: input.origin, owner: input.owner, bot: input.bindingId, room: input.room, nonce: "33333333-3333-4333-8333-333333333333" });
  assert.equal(f.calls[1].proof.publicKey, identity.publicKey);
});

test("coalesces repeated selections for the same invitation", async () => {
  const f = fixture();
  let release;
  f.gate(new Promise(resolve => { release = resolve; }));
  const first = f.registration.register(input), second = f.registration.register(input);
  release();
  await Promise.all([first, second]);
  assert.equal(f.count(), 1);
});

test("does not invite when the account changes during signing", async () => {
  const f = fixture();
  let release;
  f.gate(new Promise(resolve => { release = resolve; }));
  const pending = f.registration.register(input);
  await new Promise(resolve => setImmediate(resolve));
  f.switchAccount(); release();
  await assert.rejects(pending, /account_changed/);
  assert.equal(f.count(), 0);
});

test("does not invite if a concurrent identity claim differs", async () => {
  const registration = createBotIdentityRegistration({
    identityStoreFor: async () => ({ identity: async () => identity }), loadIdentity: async () => ({ kind: "new" }),
    commitIdentity: async () => ({ kind: "existing", username: `bot_k${"f".repeat(64)}` }),
    currentAccount: async () => input.owner, validateTarget: async () => true, challenge: async () => { throw new Error("must not request challenge"); },
    invite: async () => { throw new Error("must not invite"); },
  });
  await assert.rejects(registration.register(input), /identity_changed/);
});

test("uses a real fixture key and refuses to rotate a registered identity after key loss", async () => {
  const { createPublicKey, verify } = await import("node:crypto");
  const { mkdtempSync, readdirSync, rmSync, unlinkSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createBotIdentityStore } = await import("./bot-identity-store.mjs");
  const directory = mkdtempSync(join(tmpdir(), "startupbot-registration-fixture-"));
  try {
    const encryption = { available: async () => true, encrypt: async text => Buffer.from(`fixture:${text}`), decrypt: async bytes => bytes.toString().slice(8) };
    const identityStore = createBotIdentityStore({ directory, encryption });
    let state = { kind: "new" }, sent = 0;
    const registration = createBotIdentityRegistration({ identityStoreFor: async () => identityStore,
      loadIdentity: async () => state,
      commitIdentity: async (_id, expected, proposed) => {
        if (expected.kind === "new" && state.kind === "new") state = { kind: "existing", username: proposed.username };
        return state;
      },
      currentAccount: async () => input.owner, validateTarget: async () => true,
      challenge: async () => ({ nonce: "33333333-3333-4333-8333-333333333333" }),
      invite: async claim => {
        const key = createPublicKey({ key: Buffer.from(`302a300506032b6570032100${claim.proof.publicKey}`, "hex"), format: "der", type: "spki" });
        const payload = Buffer.from(JSON.stringify(["startupbot-inbox-bot-claim-v1", input.origin, input.owner, input.bindingId, input.room, claim.proof.nonce]));
        assert.equal(verify(null, payload, key, Buffer.from(claim.proof.signature, "hex")), true);
        sent++;
      },
    });
    const first = await registration.register(input);
    assert.equal(first.username, state.username);
    unlinkSync(join(directory, readdirSync(directory).find(name => name.endsWith(".enc"))));
    await assert.rejects(registration.register(input), /missing/);
    assert.equal(sent, 1);
    assert.equal(readdirSync(directory).some(name => name.endsWith(".enc")), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("stops before invite when the bot or workspace changes", async () => {
  let checks = 0, sent = 0;
  const registration = createBotIdentityRegistration({
    identityStoreFor: async () => ({ identity: async () => identity, signClaim: async () => ({ ...identity, signature: "c".repeat(128) }) }),
    loadIdentity: async () => ({ kind: "new" }), commitIdentity: async () => ({ kind: "existing", username: identity.username }),
    currentAccount: async () => input.owner, validateTarget: async () => ++checks < 4,
    challenge: async () => ({ nonce: "33333333-3333-4333-8333-333333333333" }), invite: async () => { sent++; },
  });
  await assert.rejects(registration.register(input), /target_changed/);
  assert.equal(sent, 0);
});

test("an atomic workspace-bound identity commit refuses a switch during the write", async () => {
  let workspace = input.workspaceId, release, entered;
  const atCommit = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const writes = [];
  const registration = createBotIdentityRegistration({
    identityStoreFor: async () => ({ identity: async () => identity }),
    loadIdentity: async scope => { assert.equal(scope.workspaceId, input.workspaceId); return { kind: "new" }; },
    commitIdentity: async (scope, _expected, proposed) => {
      entered(); await gate;
      if (workspace !== scope.workspaceId) throw new Error("target_changed");
      writes.push({ workspace: scope.workspaceId, username: proposed.username });
      return { kind: "existing", username: proposed.username };
    },
    currentAccount: async () => input.owner, validateTarget: async scope => workspace === scope.workspaceId,
    challenge: async () => { throw new Error("must not request challenge"); }, invite: async () => { throw new Error("must not invite"); },
  });
  const pending = registration.register(input);
  await atCommit;
  workspace = "other-workspace"; release();
  await assert.rejects(pending, /target_changed/);
  assert.deepEqual(writes, []);
});

test("uses one fixture identity when two rooms register the same bot concurrently", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createBotIdentityStore } = await import("./bot-identity-store.mjs");
  const directory = mkdtempSync(join(tmpdir(), "startupbot-two-rooms-fixture-"));
  try {
    const encryption = { available: async () => true, encrypt: async text => Buffer.from(`fixture:${text}`), decrypt: async bytes => bytes.toString().slice(8) };
    const identityStore = createBotIdentityStore({ directory, encryption });
    let state = { kind: "new" };
    const invited = [];
    const registration = createBotIdentityRegistration({ identityStoreFor: async () => identityStore,
      loadIdentity: async () => ({ ...state }),
      commitIdentity: async (_scope, expected, proposed) => {
        if (expected.kind === "new" && state.kind === "new") state = { kind: "existing", username: proposed.username };
        return { ...state };
      },
      currentAccount: async () => input.owner, validateTarget: async () => true,
      challenge: async () => ({ nonce: "33333333-3333-4333-8333-333333333333" }),
      invite: async claim => { invited.push(claim); },
    });
    const other = { ...input, room: "44444444-4444-4444-8444-444444444444" };
    const results = await Promise.all([registration.register(input), registration.register(other)]);
    assert.equal(results[0].username, results[1].username);
    assert.equal(invited.length, 2);
    assert.deepEqual(new Set(invited.map(row => row.room)), new Set([input.room, other.room]));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
