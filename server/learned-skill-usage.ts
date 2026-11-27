import type { StatementSync } from "node:sqlite";

export const SKILL_USAGE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS learned_skill_usage (
    generation TEXT NOT NULL, bot TEXT NOT NULL, thread TEXT NOT NULL, message TEXT NOT NULL,
    skill TEXT NOT NULL, revision TEXT NOT NULL, started INTEGER NOT NULL, outcome TEXT,
    PRIMARY KEY (generation, skill)
  );
  CREATE INDEX IF NOT EXISTS learned_skill_usage_bot ON learned_skill_usage(bot, skill, revision);
  CREATE INDEX IF NOT EXISTS learned_skill_usage_message ON learned_skill_usage(thread, message);
  CREATE TRIGGER IF NOT EXISTS delete_learned_skill_usage AFTER DELETE ON messages BEGIN
    DELETE FROM learned_skill_usage WHERE thread = OLD.thread_id AND message = OLD.id;
  END;`;

export interface SkillUsageSummary { calls: number; lastAt: number; failed: number; priorCalls: number }
export function createSkillUsage(prepare: (sql: string) => StatementSync) {
  const pending = new Set<string>();
  return {
    started(turn: { generation: string; bot: string; thread: string; message: string }, skill: string, revision: string, now = Date.now()) {
      prepare(`INSERT OR IGNORE INTO learned_skill_usage(generation, bot, thread, message, skill, revision, started)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM messages WHERE thread_id = ? AND id = ?)`)
        .run(turn.generation, turn.bot, turn.thread, turn.message, skill, revision, now, turn.thread, turn.message);
      pending.add(turn.generation);
    },
    settled(generation: string, ok: boolean) {
      if (!pending.delete(generation)) return;
      prepare("UPDATE learned_skill_usage SET outcome = ? WHERE generation = ? AND outcome IS NULL").run(ok ? "completed" : "failed", generation);
    },
    summaries(bot: string, revisions: ReadonlyMap<string, string>, visible: (thread: string) => boolean): Map<string, SkillUsageSummary> {
      const summaries = new Map<string, SkillUsageSummary>();
      const rows = prepare(`SELECT thread, skill, revision, COUNT(*) AS calls, MAX(started) AS last_at, SUM(outcome = 'failed') AS failed
        FROM learned_skill_usage WHERE bot = ? GROUP BY thread, skill, revision`).iterate(bot);
      for (const row of rows) {
        const skill = String(row.skill);
        if (!revisions.has(skill) || !visible(String(row.thread))) continue;
        const summary = summaries.get(skill) ?? { calls: 0, lastAt: 0, failed: 0, priorCalls: 0 };
        if (row.revision === revisions.get(skill)) {
          summary.calls += Number(row.calls);
          summary.lastAt = Math.max(summary.lastAt, Number(row.last_at));
          summary.failed += Number(row.failed ?? 0);
        } else summary.priorCalls += Number(row.calls);
        summaries.set(skill, summary);
      }
      return summaries;
    },
  };
}
