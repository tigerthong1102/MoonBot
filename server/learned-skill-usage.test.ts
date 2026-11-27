import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { createSkillUsage, SKILL_USAGE_SCHEMA } from "./learned-skill-usage.ts";

it("deduplicates explicit uses and filters by revision, thread visibility and transcript retention", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE messages(thread_id TEXT,id TEXT); INSERT INTO messages VALUES ('one','m'),('two','m');" + SKILL_USAGE_SCHEMA);
  try {
    const usage = createSkillUsage(sql => db.prepare(sql));
    const start = (generation: string, thread: string, revision = "r1") => usage.started({ generation, bot: "bot", thread, message: "m" }, "review", revision, 15);
    start("a", "one"); start("a", "one"); usage.settled("a", false);
    start("b", "two"); start("c", "one", "old");
    const summary = () => usage.summaries("bot", new Map([["review", "r1"]]), id => id === "one").get("review");
    expect(summary()).toEqual({ calls: 1, failed: 1, lastAt: 15, priorCalls: 1 });
    db.prepare("DELETE FROM messages WHERE thread_id='one'").run();
    expect(summary()).toBeUndefined();
  } finally { db.close(); }
});
