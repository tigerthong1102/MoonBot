import type { DatabaseSync } from "node:sqlite";

/** A file in attachments/, by its URL or by its path (as JSON escapes it) a sent document's tag carries. */
export const ATTACHMENT_IN_TRANSCRIPT = /attachments(?:\/|\\)+([A-Za-z0-9][\w.-]{0,200})/g;

export const TRANSCRIPT_RETENTION_SCHEMA = `
    CREATE TABLE IF NOT EXISTS report_sections (
      thread_id TEXT NOT NULL, message_id TEXT NOT NULL, source_thread TEXT NOT NULL, source_message TEXT NOT NULL,
      PRIMARY KEY(thread_id, message_id, source_thread, source_message)
    );
    CREATE INDEX IF NOT EXISTS report_section_sources ON report_sections(source_thread);
    CREATE TABLE IF NOT EXISTS cleared_transcripts (thread_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS retained_uploads (thread_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (thread_id, name));
    CREATE TABLE IF NOT EXISTS retained_chat_docs (
      thread_id TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (thread_id, doc)
    );
`;

export function clearTranscriptRows(connection: DatabaseSync, threadId: string) {
  const retain = connection.prepare("INSERT OR IGNORE INTO retained_uploads(thread_id, name) VALUES (?, ?)");
  for (const row of connection.prepare("SELECT json FROM messages WHERE thread_id = ?").iterate(threadId)) {
    for (const match of String(row.json).matchAll(ATTACHMENT_IN_TRANSCRIPT)) retain.run(threadId, match[1]!);
  }
  connection.prepare("INSERT OR IGNORE INTO cleared_transcripts(thread_id) VALUES (?)").run(threadId);
  connection.prepare(`INSERT OR IGNORE INTO retained_chat_docs(thread_id, doc)
    SELECT thread_id, json_extract(json, '$.app.doc') FROM messages WHERE thread_id = ? AND kind = 'app'
    UNION SELECT thread_id, json_extract(json, '$.app.report.doc') FROM messages WHERE thread_id = ? AND json_type(json, '$.app.report.doc') = 'text'
    UNION SELECT thread_id, h.value FROM messages m, json_each(m.json, '$.app.history') h WHERE thread_id = ? AND kind = 'app'`).run(threadId, threadId, threadId);
  connection.prepare("DELETE FROM report_sections WHERE thread_id = ? OR source_thread = ?").run(threadId, threadId);
  connection.prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId);
  connection.prepare("DELETE FROM notification_log WHERE thread_id = ?").run(threadId);
}

export function deleteTranscriptRows(connection: DatabaseSync, threadIds: readonly string[]) {
  const statements = [
    connection.prepare("DELETE FROM chat_followups WHERE thread_id = ?"),
    connection.prepare("DELETE FROM report_sections WHERE thread_id = ?"),
    connection.prepare("DELETE FROM report_sections WHERE source_thread = ?"),
    connection.prepare("DELETE FROM messages WHERE thread_id = ?"),
    connection.prepare("DELETE FROM thread_state WHERE thread_id = ?"),
    connection.prepare("DELETE FROM cleared_transcripts WHERE thread_id = ?"),
    connection.prepare("DELETE FROM retained_uploads WHERE thread_id = ?"),
    connection.prepare("DELETE FROM retained_chat_docs WHERE thread_id = ?"),
    connection.prepare("DELETE FROM notification_log WHERE thread_id = ?"),
  ];
  for (const id of threadIds) for (const statement of statements) statement.run(id);
}


export function referencingThreads(connection: DatabaseSync, fragment: string): string[] {
  if (!fragment) return [];
  const rows = connection.prepare(`SELECT thread_id FROM messages WHERE instr(json, ?) > 0
    UNION SELECT thread_id FROM retained_uploads WHERE name = ?`).all(fragment, fragment);
  return rows.map((row) => String(row.thread_id));
}
