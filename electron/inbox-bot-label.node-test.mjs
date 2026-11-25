import { test } from "node:test";
import assert from "node:assert/strict";
import { inboxBotLabel } from "./inbox-bot-label.mjs";

test("native invite labels distinguish names and tolerate an older server", () => {
  assert.notEqual(inboxBotLabel({ name: "Scout", username: "bot_x0061" }), inboxBotLabel({ name: "Scout", username: "bot_x0062" }));
  assert.equal(inboxBotLabel({ name: "Scout" }), "Scout");
});
