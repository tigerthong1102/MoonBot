import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createPersonalInboxClaims } from "./personal-inbox-claims.mjs";

test("uses the owner-only invitation endpoint and rejects invalid rooms before sending", async () => {
  const calls = [];
  const claims = createPersonalInboxClaims(async (...args) => { calls.push(args); return { ok: true }; });
  const input = { room: "11111111-1111-4111-8111-111111111111", owner: "fixture-owner", bot: "fixture-bot", name: "Fixture" };
  await claims.inviteLegacy(input);
  assert.deepEqual(calls, [[`rooms/${input.room}/bots`, { action: "invite", owner: input.owner, bot: input.bot, name: input.name }]]);
  assert.throws(() => claims.inviteLegacy({ ...input, room: "../other" }), /invalid_room/);
  assert.equal(calls.length, 1);
});
