import { messageFileTargets } from "./message-file.ts";
import type { Message } from "./store.ts";

type Reason = "data" | "files" | null;
const cache = new WeakMap<Message, { text: string | undefined; hasData: boolean; attachmentCount: number; reason: Reason }>();

export function unsupportedWorkBotContext(messages: readonly Message[]): "data" | "files" | null {
  for (const message of messages) {
    const text = message.text, hasData = Boolean(message.dataContext), attachmentCount = message.attachments?.length ?? 0;
    const known = cache.get(message);
    if (known && known.text === text && known.hasData === hasData && known.attachmentCount === attachmentCount) {
      if (known.reason) return known.reason;
      continue;
    }
    let reason: Reason = null;
    if (hasData) reason = "data";
    else if (attachmentCount || /<attached-(?:file|image)\b/i.test(text ?? "") || /(?:file:\/\/|(?<![\w])[a-z]:[\\/]|\\\\|(?:^|[^:\w/])\/(?!\/))\S+/i.test(text ?? "") || (/\]\s*[([]/.test(text ?? "") && messageFileTargets(text ?? "").length)) reason = "files";
    cache.set(message, { text, hasData, attachmentCount, reason });
    if (reason) return reason;
  }
  return null;
}

export async function scanWorkBotContext(messages: readonly Message[], signal: AbortSignal): Promise<Reason> {
  for (let offset = 0; offset < messages.length; offset += 100) {
    if (signal.aborted) return null;
    const reason = unsupportedWorkBotContext(messages.slice(offset, offset + 100));
    if (reason) return reason;
    if (offset + 100 < messages.length) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return null;
}

export function captureWorkBotContext(messages: readonly Message[], current: () => readonly Message[], sourceIndex: number): () => void {
  const versions = messages.map(row => ({ row, text: row.text, data: Boolean(row.dataContext), attachments: row.attachments?.length ?? 0 }));
  return () => {
    const latest = current();
    if (latest.length !== versions.length || latest.some((row, index) => {
      const previous = versions[index];
      return !previous || row !== previous.row || row.text !== previous.text || Boolean(row.dataContext) !== previous.data || (row.attachments?.length ?? 0) !== previous.attachments;
    }) || unsupportedWorkBotContext(latest.slice(0, sourceIndex + 1))) throw new Error("The conversation context changed during handoff");
  };
}
