import { rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, EVENTS_DIR, NATIVE_DIR } from "./config.ts";
import { discardNativeLog } from "./drivers/native.ts";
import type { TaskRecord } from "./store.ts";

export const messagesFile = (threadId: string) => join(DATA_DIR, `messages-${threadId}.json`);

export function discardTranscriptFiles(threadId: string) {
  discardNativeLog(threadId);
  if (/^[\w-]+$/.test(threadId)) {
    try { rmSync(join(DATA_DIR, "tool-results", threadId), { recursive: true, force: true }); }
    catch (error) { console.warn("Could not remove the deleted transcript's tool results", error); }
  }
  for (const file of [
    messagesFile(threadId),
    `${messagesFile(threadId)}.imported`,
    join(EVENTS_DIR, `${threadId}.ndjson`),
    join(NATIVE_DIR, `${threadId}.ndjson`),
  ]) {
    try {
      unlinkSync(file);
    } catch {}
  }
}

export function resetTranscriptState(task: TaskRecord) {
  task.resumeCursors = {};
  task.rewound = true;
  task.unread = false;
  task.updatedAt = task.createdAt;
  for (const key of ["lastReadMessageId", "pinnedMessageId", "lastInstanceId", "handedMessages", "appliedCompactionId",
    "contextFloor", "lastContextModel", "lastThreadOrderAt"] as const) delete task[key];
}
