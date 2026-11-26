import type { Store } from "../store.ts";

export function recordStoppedRequest(store: Store, botId: string, threadId: string, messageId: string): unknown[] {
  const failures: unknown[] = [];
  let message: ReturnType<Store["messagesFor"]>[number] | undefined;
  try { message = store.messagesFor(threadId).find(row => row.id === messageId); } catch (error) { failures.push(error); }
  try { store.patchMessage(threadId, messageId, { requestCancelled: true }); } catch (error) { failures.push(error); }
  if (!message || message.workBotRouting || message.workBotHandoffSource) {
    try { store.patchTask(botId, threadId, { rewound: true, resumeCursors: {} }); }
    catch (error) {
      const task = store.taskByThread(botId, threadId);
      if (task) { task.rewound = true; task.resumeCursors = {}; }
      failures.push(error);
    }
  }
  return failures;
}
