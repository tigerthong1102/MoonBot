import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createMobileDraftReceiver } from "./mobile-draft-receiver.mjs";
import { draftKeys, sealDraft, unsealDraft } from "./mobile-desktop-envelope.mjs";

const listener = crypto.randomUUID(),
  id = crypto.randomUUID();
function fixture(respond) {
  const document = {
    companionAccountEmail: "pilot@example.test",
    companionAccountUserId: "first",
    companionAccountToken: "account-token",
    companionInstallationId: crypto.randomUUID(),
    companionInstallationCredential: "omb_install_" + "a".repeat(22) + "." + "b".repeat(43),
  };
  const sender = new EventEmitter(),
    calls = [];
  const receive = createMobileDraftReceiver({
    credentials: () => document,
    allowed: () => true,
    client: () => ({
      mobileDesktopDraft: async (token, input, operation) => {
        if (operation === "arm") {
          assert.equal(token, document.companionAccountToken);
          assert.equal(input.installation, document.companionInstallationId);
          return { ok: true };
        }
        calls.push(input.action);
        return respond(input);
      },
    }),
  });
  return { document, sender, calls, invoke: (action) => receive(sender, action, listener, id) };
}
test("only the receiving window key and intended request can decrypt a phone draft", async () => {
  const keys = await draftKeys(),
    other = await draftKeys(),
    packet = await sealDraft("Mở Excel", keys.publicKey, id, listener);
  assert.equal(await unsealDraft(packet, keys.privateKey, id, listener), "Mở Excel");
  await assert.rejects(unsealDraft(packet, other.privateKey, id, listener));
  await assert.rejects(unsealDraft(packet, keys.privateKey, crypto.randomUUID(), listener));
});
for (const change of ["signout", "account switch", "closed window"]) {
  test("an in-flight poll releases no plaintext after " + change, async () => {
    let release, started;
    const waiting = new Promise((resolve) => {
      started = resolve;
    });
    const f = fixture(async (input) => {
      if (input.action !== "poll") return { ok: true };
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      return {
        draft: {
          id,
          expires: Date.now() + 5000,
          envelope: await sealDraft("private", input.publicKey, id, listener),
        },
      };
    });
    await f.invoke("open");
    const result = f.invoke("poll");
    await waiting;
    if (change === "signout") f.document.companionAccountCleanupPending = true;
    if (change === "account switch") f.document.companionAccountUserId = "second";
    if (change === "closed window") f.sender.emit("destroyed");
    release();
    await assert.rejects(result);
    await f.invoke("close");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.calls, ["poll", "close"]);
  });
}
