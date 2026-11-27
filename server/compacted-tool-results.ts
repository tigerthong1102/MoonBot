import type { Message } from "./store.ts";
import { boundedContextText, MAX_SUMMARY_BYTES, toolReplayLine } from "./context-rebuild.ts";
import { redactSecretsInText } from "./redact.ts";
import { replayToolHistoryEnabled } from "./replay-settings.ts";

function savedOutput(message: Message) {
  return message.kind === "activity" && message.tool?.itemId && !message.tool.setup ? message.tool.output : undefined;
}

export function summaryWithToolReferences(summary: string, threadId: string, path: readonly Message[], foldedThrough: string): string {
  const end = path.findIndex(message => message.id === foldedThrough);
  if (end < 0) return summary;
  const references: string[] = [];
  let bytes = 0;
  for (let i = end; i >= 0; i--) {
    const message = path[i]!;
    if (!savedOutput(message)) continue;
    const line = `${JSON.stringify(message.id)} ${toolReplayLine(message.tool!)}`;
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > 1_500) break;
    references.unshift(line);
  }
  if (!references.length) return summary;
  const suffix = `\n\nSaved tool outputs on this branch. Read one with session_search(thread_id=${JSON.stringify(threadId)}, message_id=<id>). Cite the message id.\n${references.join("\n")}`;
  return boundedContextText(summary, MAX_SUMMARY_BYTES - Buffer.byteLength(suffix)) + suffix;
}

export function readCompactedToolOutput(threadId: string, messageId: string, path: readonly Message[]) {
  const message = path.find(item => item.id === messageId);
  const output = message && savedOutput(message);
  if (!message || !output) return null;
  return { threadId, messageId, at: message.at, role: "bot", text: `Stored tool output from ${toolReplayLine(message.tool!)}\n${redactSecretsInText(output)}` };
}

export function toolRecallEnabled(settings: { replayToolHistory?: boolean } | undefined, memoryEnabled: boolean | undefined) {
  return memoryEnabled !== false && replayToolHistoryEnabled(settings);
}
