import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Ledger } from "../../apps/ai-pilot/ledger.mjs";
import { budgetExposure, initializeManagedBudget } from "../../apps/ai-pilot/managed-budget.mjs";
import { startMobileFixture } from "./mobile-chat-fixture.mjs";

let f;
beforeEach(async () => { f = await startMobileFixture(); f.grant("budget"); });
afterEach(async () => f.close());

it("carries unresolved money across UTC months and applies settlement to the original booking day", () => {
  const old = Date.UTC(2026,8,30), next = Date.UTC(2026,9,1);
  const id = randomUUID();
  f.ledger.reserve("budget", id, "fixture", 100);
  f.ledger.db.prepare("UPDATE requests SET created=? WHERE id=?").run(old, id);
  expect(budgetExposure(f.ledger.db,next)).toEqual({ day:100, month:100, held:100 });
  f.ledger.settle("budget", id, "generation", 35);
  f.ledger.settle("budget", id, "generation", 35);
  expect(budgetExposure(f.ledger.db,old)).toEqual({ day:35, month:35, held:0 });
  expect(budgetExposure(f.ledger.db,next)).toEqual({ day:0, month:0, held:0 });
});

it("backfills previous charges once and keeps transactions and an older SQL writer consistent", () => {
  const db = f.ledger.db, id = randomUUID();
  db.exec("DROP TRIGGER managed_cost_insert; DROP TRIGGER managed_cost_update; DROP TRIGGER managed_cost_delete; DROP TABLE managed_daily_cost");
  f.ledger.reserve("budget", id, "fixture", 100);
  f.ledger.settle("budget", id, "generation", 50);
  initializeManagedBudget(f.ledger);
  const other = new Ledger(f.file);
  try {
    expect(budgetExposure(other.db).day).toBe(50);
    expect(() => other.tx(() => {
      other.db.prepare("UPDATE requests SET cost=60 WHERE id=?").run(id);
      throw new Error("fixture rollback");
    })).toThrow("fixture rollback");
    expect(budgetExposure(db).day).toBe(50);
    other.db.prepare("UPDATE requests SET cost=60 WHERE id=?").run(id);
    expect(budgetExposure(db).day).toBe(60);
    initializeManagedBudget(other);
    expect(budgetExposure(other.db).day).toBe(60);
  } finally { other.db.close(); }
});
