import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createZaloInbox } from "../../../server/zalo-inbox.ts";
import { createFixtureDelivery } from "./fixture-delivery.mjs";

test("acceptance followed by lost receipt consumes exact approval across reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "zalo-delivery-"));
  const file = join(directory, "inbox.db");
  let db = new DatabaseSync(file);
  const accepted = [];
  let time = 1795842000000;
  const now = () => time;
  try {
    const inbox = createZaloInbox(db, now);
    const scope = { adapter: "personal", accountId: "10", conversationId: "20", conversationType: "group", senderId: "30" };
    const grantId = inbox.enroll({ ...scope, retentionDays: 1 });
    for (const messageId of ["50", "51", "52"]) {
      inbox.accept({ ...scope, messageId, timestamp: time, text: "Báo giá?", direction: "incoming" }, grantId);
    }
    const draft = { ...scope, grantId, sourceId: "50", revision: 1, text: "Tôi sẽ kiểm tra." };
    const lost = createFixtureDelivery(db, now, () => { accepted.push("50"); throw new Error("lost_receipt"); });
    const id = lost.approve(draft, time + 5000);
    for (const change of [{ accountId: "11" }, { conversationId: "21" }, { conversationType: "direct" },
      { revision: 2 }, { text: "Thay đổi" }, { grantId: "another" }, { sourceId: "51" }]) {
      assert.equal(lost.attempt(id, { ...draft, ...change }), "denied");
    }
    assert.equal(lost.attempt(id, draft), "unknown");
    db.close();
    db = new DatabaseSync(file);
    const restored = createZaloInbox(db, now);
    const delivery = createFixtureDelivery(db, now, () => accepted.push("accepted"));
    assert.equal(delivery.attempt(id, draft), "unknown");
    assert.throws(() => delivery.approve(draft, time + 5000));
    assert.deepEqual(accepted, ["50"]);
    const overdue = { ...draft, sourceId: "51" };
    const expired = delivery.approve(overdue, time + 1);
    time += 2;
    assert.equal(delivery.attempt(expired, overdue), "denied");
    const renewed = delivery.approve(overdue, time + 2000);
    assert.equal(delivery.attempt(expired, overdue), "denied");
    const revised = { ...overdue, revision: 2, text: "Tôi sẽ hỏi lại." };
    const edited = delivery.approve(revised, time + 1000);
    assert.equal(delivery.attempt(renewed, overdue), "denied");
    assert.throws(() => delivery.approve(overdue, time + 1000));
    assert.equal(delivery.attempt(edited, revised), "confirmed");
    const confirmed = { ...draft, sourceId: "52" };
    const grant = delivery.approve(confirmed, time + 1000);
    assert.equal(delivery.attempt(grant, confirmed), "confirmed");
    assert.equal(delivery.attempt(grant, confirmed), "confirmed");
    restored.revoke(grantId);
    assert.equal(delivery.attempt(id, draft), "denied");
    assert.deepEqual(accepted, ["50", "accepted", "accepted"]);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
