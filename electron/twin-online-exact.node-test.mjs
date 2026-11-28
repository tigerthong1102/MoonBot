import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnlineExact, recoverExact } from "./twin-online-exact.mjs";
import { exactReplyJournal } from "./twin-exact-journal.mjs";

const origin = "https://fixture.invalid";
function deferred() {
  return Promise.withResolvers();
}
function fixture(t, opts = {}) {
  const directory = mkdtempSync(join(tmpdir(), "exact-journal-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const journal = exactReplyJournal(directory),
    serverNow = opts.serverNow ?? Date.now(),
    owner = randomUUID();
  const state = {
    ...generateKeyPairSync("ed25519"),
    id: randomUUID(),
    twin: randomUUID(),
    revision: 1,
    owner,
    origin,
    expires: serverNow + 60000,
  };
  state.key = state.privateKey;
  const lesson = { id: randomUUID(), source: "owner", origin: "manual", question: "Time?", answer: "Noon." };
  const twin = { id: state.twin, revision: 1, paused: false };
  const calls = [];
  let elapsed = 0;
  async function inbox(path, a) {
    if (path === "me") return { id: owner, exactAnswer: true };
    if (path.endsWith("?rooms=1")) return { owner, rooms: [] };
    calls.push(a);
    if (a.action === "claim")
      return {
        now: serverNow,
        challenge: { source: 43, room: randomUUID(), nonce: randomUUID(), expires: serverNow + 4000 },
      };
    if (a.action === "finish") return { source: a.source, published: true };
    if (a.action === "revoke") return { id: a.id, revoked: true };
    return { id: a.id, offered: true };
  }
  const signer = createOnlineExact({
    state: () => state,
    check: async () => {},
    profile: async () => ({ twin, lessons: [lesson] }),
    inbox,
    origin,
    journal,
    approve: async () => true,
    monotonic: () => elapsed,
    ...opts,
  });
  return {
    signer,
    twin,
    lesson,
    journal,
    calls,
    owner,
    directory,
    inbox,
    advance: (ms) => {
      elapsed += ms;
    },
  };
}

test("stopping while native approval waits cancels the offer", async (t) => {
  const open = deferred(),
    decision = deferred();
  const f = fixture(t, {
    approve: async () => {
      open.resolve();
      return decision.promise;
    },
  });
  const pending = f.signer.offer(f.lesson.id, ["*"]);
  await open.promise;
  await f.signer.stop();
  decision.resolve(true);
  await assert.rejects(pending);
  assert.equal(f.journal.hasPending(), false);
  assert.equal(f.calls.length, 0);
});
test("pause while checking the account prevents signing with the previous local revision", async (t) => {
  const access = deferred(),
    resume = deferred();
  let checks = 0;
  const f = fixture(t, {
    check: async () => {
      if (++checks === 4) {
        access.resolve();
        await resume.promise;
      }
    },
  });
  assert.equal(await f.signer.offer(f.lesson.id, ["*"]), true);
  const pending = f.signer.tick();
  await access.promise;
  f.twin.paused = true;
  resume.resolve();
  await pending;
  assert.deepEqual(
    f.calls.map((a) => a.action),
    ["offer", "claim", "revoke"],
  );
});
for (const skew of [-86_400_000, 86_400_000])
  test("signing uses the central clock with local wall-clock offset " + skew, async (t) => {
    const f = fixture(t, { serverNow: Date.now() + skew });
    assert.equal(await f.signer.offer(f.lesson.id, ["*"]), true);
    await f.signer.tick();
    assert.deepEqual(
      f.calls.map((a) => a.action),
      ["offer", "claim", "finish"],
    );
  });
test("an offline restart keeps recovery pending until an authenticated readback succeeds", async (t) => {
  const f = fixture(t);
  await f.signer.offer(f.lesson.id, ["*"]);
  const restarted = exactReplyJournal(f.directory);
  assert.equal(restarted.hasPending(), true);
  await assert.rejects(
    recoverExact({
      journal: restarted,
      origin,
      inbox: async () => {
        throw Error("offline");
      },
    }),
  );
  await recoverExact({ journal: restarted, origin, inbox: async () => ({ id: randomUUID() }) });
  assert.equal(restarted.hasPending(), true);
  await recoverExact({ journal: restarted, origin, inbox: f.inbox });
  assert.equal(restarted.hasPending(), false);
});

for (const origin of [undefined, "conversation"]) {
  test(`does not offer a lesson without manual provenance (${origin})`, async (t) => {
    const f = fixture(t);
    f.lesson.origin = origin;
    await assert.rejects(f.signer.offer(f.lesson.id, ["*"]));
    assert.equal(f.calls.length, 0);
  });
}
