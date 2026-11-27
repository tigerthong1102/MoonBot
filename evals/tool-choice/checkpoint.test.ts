import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { fixtureHash } from "./compare.ts";
import { TrajectoryCheckpoint, usableTrace } from "./checkpoint.ts";
it("resumes with only complete matching trajectories after an interrupted case", async () => {
  const root = mkdtempSync(join(tmpdir(), "trajectory-")), file = join(root, "run.db");
  let db = new TrajectoryCheckpoint(file, "synthetic:demo");
  const row = { id: "invoice", fixtureHash: fixtureHash("invoice"), done: true, score: { pass: true, searched: false }, answerCorrect: true, citationCorrect: true, elapsedMs: 2, costUsd: 0, calls: ["lookup"], reply: "INV-42" };
  try {
    await expect(db.run(row.id, row.fixtureHash, async () => { throw new Error("interrupted"); })).rejects.toThrow();
    expect(usableTrace(await db.run(row.id, row.fixtureHash, async () => row))).toBe(true);
    db.close(); db = new TrajectoryCheckpoint(file, "synthetic:demo");
    expect(await db.run(row.id, row.fixtureHash, async () => { throw new Error("duplicate"); })).toMatchObject(row);
    expect(() => new TrajectoryCheckpoint(file, "other")).toThrow("different corpus");
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
