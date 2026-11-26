import { prepared } from "../message-db.ts";

/** Private references stay in the database. The HTTP layer only returns sources this viewer can read. */
export function reportSections(threadId: string, messageId: string): Array<{ threadId: string; messageId: string }> {
  return prepared("SELECT source_thread AS threadId, source_message AS messageId FROM report_sections WHERE thread_id = ? AND message_id = ? ORDER BY rowid")
    .all(threadId, messageId) as Array<{ threadId: string; messageId: string }>;
}

export function changeReportSection(threadId: string, messageId: string, sourceThread: string, sourceMessage: string, remove: boolean): boolean {
  if (remove) {
    prepared("DELETE FROM report_sections WHERE thread_id = ? AND message_id = ? AND source_thread = ? AND source_message = ?")
      .run(threadId, messageId, sourceThread, sourceMessage);
    return true;
  }
  const present = reportSections(threadId, messageId);
  if (present.some(ref => ref.threadId === sourceThread && ref.messageId === sourceMessage)) return true;
  if (present.length >= 12) return false;
  prepared("INSERT INTO report_sections(thread_id, message_id, source_thread, source_message) VALUES (?, ?, ?, ?)")
    .run(threadId, messageId, sourceThread, sourceMessage);
  return true;
}
