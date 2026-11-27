// A read-only consumer of the runtime ledger. No prompts, event details or assignment JSON are selected.
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { EventKind } from "./types.ts";

const names = {
  enqueued: "request.enqueued", refused: "request.refused", admitted: "request.admitted",
  started: "turn.started", progress: "turn.progress", parked: "interaction.requested",
  answered: "interaction.answered", waiting: "turn.waiting", resume_due: "turn.resume_due",
  settled: "request.settled", reported: "request.reported", woken: "request.woken",
  cancelled: "request.cancelled", restart_reconciled: "session.reconciled", budget: "request.budget",
  stalled: "turn.stalled", continued: "turn.continued", held: "request.held", reminded: "interaction.reminded",
} as const satisfies Record<EventKind, string>;

export function readLifecyclePage(database: string, identityKey: Buffer, after = 0, limit = 200) {
  if (identityKey.length < 32) throw new Error("Use an installation-specific key of at least 32 bytes.");
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("Choose a nonnegative cursor and a page size between 1 and 1000.");
  }
  const id = (namespace: string, ...values: (string | number | null)[]) =>
    createHmac("sha256", identityKey).update(JSON.stringify([namespace, ...values])).digest("hex").slice(0, 32);
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT e.id, e.at, e.kind, a.id AS assignment, a.root_id AS root, a.parent_id AS parent,
             a.assignee_bot_id AS worker, a.assignee_thread_id AS session,
             (SELECT s.id FROM assignment_events s WHERE s.assignment_id=e.assignment_id
                AND s.kind='started' AND s.id<=e.id ORDER BY s.id DESC LIMIT 1) AS turn
        FROM assignment_events e JOIN assignments a ON a.id=e.assignment_id
       WHERE e.id>? ORDER BY e.id LIMIT ?
    `).all(after, limit);
    const events = rows.map(row => {
      const worker = String(row.worker);
      const assignment = String(row.assignment);
      return {
        version: 1 as const, cursor: Number(row.id), at: Number(row.at),
        event: Object.hasOwn(names, String(row.kind)) ? names[row.kind as EventKind] : "request.unknown",
        runId: id("run", String(row.root)), assignmentId: id("assignment", assignment),
        parentAssignmentId: row.parent == null ? null : id("assignment", String(row.parent)),
        turnId: row.turn == null ? null : id("turn", assignment, Number(row.turn)),
        workerId: id("worker", worker), sessionId: row.session ? id("session", worker, String(row.session)) : null,
      };
    });
    return { events, nextCursor: events.at(-1)?.cursor ?? after };
  } finally {
    db.close();
  }
}
