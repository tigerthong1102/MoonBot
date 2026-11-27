import { DatabaseSync } from "node:sqlite";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { pairedRow } from "./compare.ts";
import { redactSecretsInText } from "../../shared/redact.ts";

const trajectory = pairedRow.extend({
  score: z.object({ pass: z.boolean(), chosen: z.string().optional(), searched: z.boolean() }),
  reply: z.string().max(200), inputTokens: z.number().nonnegative().optional(),
});
export type Trace = z.infer<typeof trajectory>;

export class TrajectoryCheckpoint {
  private readonly db: DatabaseSync;
  constructor(file: string, identity: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    closeSync(openSync(file, "a", 0o600));
    this.db = new DatabaseSync(file);
    try {
      this.db.exec("BEGIN IMMEDIATE");
      this.db.exec("CREATE TABLE IF NOT EXISTS run (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL); CREATE TABLE IF NOT EXISTS trajectory (id TEXT PRIMARY KEY, row TEXT NOT NULL)");
      this.db.prepare("INSERT OR IGNORE INTO run VALUES(1,?)").run(identity);
      if (this.db.prepare("SELECT identity FROM run").get()?.identity !== identity) throw new Error("Checkpoint belongs to a different corpus, revision or model.");
      this.db.exec("COMMIT");
    } catch (error) { this.db.close(); throw error; }
  }

  async run(id: string, hash: string, execute: () => Promise<Trace>): Promise<Trace> {
    // The transaction is the per-case claim. A killed synthetic run releases it
    // without publishing a partial trace; a competing process cannot run it.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const saved = this.db.prepare("SELECT row FROM trajectory WHERE id=?").get(id);
      const result = trajectory.parse(saved ? JSON.parse(String(saved.row)) : await execute());
      if (result.id !== id || result.fixtureHash !== hash) throw new Error("Checkpoint fixture changed.");
      result.reply = redactSecretsInText(result.reply).slice(0, 200);
      if (!saved) this.db.prepare("INSERT INTO trajectory VALUES(?,?)").run(id, JSON.stringify(result));
      this.db.exec("COMMIT");
      return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  close() { this.db.close(); }
}

export function usableTrace(trace: Trace): boolean {
  return trace.done && trace.score.pass && trace.answerCorrect !== false && trace.citationCorrect !== false;
}
