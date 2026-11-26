import { lstatSync } from "node:fs";
import { messageFileTargets } from "./message-file.ts";
import { isContextMessage } from "./delta-context.ts";
import { digestPromptLine } from "./digest.ts";
import type { Message } from "./store.ts";

type Reason = "data" | "files" | null;
export function workBotContextText(message: Message, botName: string): string | undefined {
  if (message.kind === "text") return message.text || undefined;
  if (message.kind === "digest" && message.digest) return digestPromptLine(message.digest, message.from?.name ?? botName);
  return undefined;
}
const cache = new WeakMap<Message, { text: string | undefined; hasData: boolean; attachmentCount: number; reason: Reason }>();

function relativeFileReference(text: string): boolean {
  return /(?<![\p{L}\p{M}\p{N}_@./:\\-])(?:\.{1,2}[\\/]|[\p{L}\p{M}\p{N}_.-]+[\\/])(?:[\p{L}\p{M}\p{N}_.-]+[\\/])*[\p{L}\p{M}\p{N}_-][\p{L}\p{M}\p{N}_.-]*\.[\p{L}\p{M}\p{N}]{1,16}(?![\p{L}\p{M}\p{N}_])/iu.test(text) ||
    /(?<![\p{L}\p{M}\p{N}_@./:\\-])\.{1,2}[\\/][\p{L}\p{M}\p{N}_.-]+/iu.test(text) ||
    /(?<![\p{L}\p{M}\p{N}_@./:\\-])[\p{L}\p{M}\p{N}_-][\p{L}\p{M}\p{N}_.-]*\.(?:csv|tsv|xlsx?|xlsm|numbers|pages|log|pdf|docx?|pptx?|txt|md|sql|sqlite|db|json|xml|zip|tar|gz|7z|png|jpe?g|webp|heic|avif|gif|tiff?|mp[34]|wav|m4a|mov)(?![\p{L}\p{M}\p{N}_@])/iu.test(text);
}

/** A bare /topic can also name a root entry. Check existence without opening its contents. */
function posixFileReference(text: string): boolean {
  for (const match of text.matchAll(/(?:^|[^:\p{L}\p{M}\p{N}_/])\/(?!\/)([^\s]+)/giu)) {
    const word = /^([\p{L}\p{M}\p{N}_-]+)[,;:!?)”’"']*$/u.exec(match[1]!);
    if (!word) return true;
    try {
      if (lstatSync(`/${word[1]}`, { throwIfNoEntry: false })) return true;
    } catch {
      return true;
    }
  }
  return false;
}

type UploadProse = (message: Message) => string | undefined;

function scanContext(messages: readonly Message[], copied: Set<string>, uploadProse?: UploadProse, portableData?: (message: Message) => boolean): Reason {
  for (const message of messages) {
    const willCopy = (message.kind === "text" && Boolean(message.text) || message.kind === "digest" && Boolean(message.digest)) && (message.role === "user" || message.role === "bot");
    if ((isContextMessage(message) && (!willCopy || message.roomRequest || message.peerAsk || message.relay || message.relayed || message.via === "api" || message.apiAsOwner || message.aside || message.fromApp || message.pointed?.length || message.automation || message.automated || message.steered || message.webhookPost || message.peerPost || message.serverCard || message.setupSuggestion || message.settingsCard || message.reaction)) || (willCopy && message.replyToId && !copied.has(message.replyToId))) return "data";
    if (willCopy) copied.add(message.id);
    const digest = message.kind === "digest" ? message.digest : undefined;
    if (digest && (digest.memory.length || digest.memoryDropped || digest.files?.changed.length || digest.files?.added.length || digest.files?.deleted.length || digest.files?.truncated)) return "files";
    const text = digest ? workBotContextText(message, "bot") : uploadProse?.(message) ?? message.text, hasData = Boolean(message.dataContext && !portableData?.(message)), attachmentCount = message.attachments?.length ?? 0;
    const known = cache.get(message);
    if (known && known.text === text && known.hasData === hasData && known.attachmentCount === attachmentCount) {
      if (known.reason) return known.reason;
      continue;
    }
    let reason: Reason = null;
    const pathText = (text ?? "").replace(/https?:\/\/[^\s<>]+/giu, " ");
    if (hasData) reason = "data";
    else if (attachmentCount || /<attached-(?:file|image)\b/i.test(text ?? "") || /(?:file:\/\/|(?<![\p{L}\p{M}\p{N}_])[a-z]:[\\/]|\\\\)\S+/iu.test(pathText) || posixFileReference(pathText) || relativeFileReference(pathText) || (/\]\s*[([]/.test(text ?? "") && messageFileTargets(text ?? "").length)) reason = "files";
    if (!pathText.includes("/")) cache.set(message, { text, hasData, attachmentCount, reason });
    if (reason) return reason;
  }
  return null;
}

export function unsupportedWorkBotContext(messages: readonly Message[], uploadProse?: UploadProse, portableData?: (message: Message) => boolean): Reason {
  return scanContext(messages, new Set(), uploadProse, portableData);
}

export async function scanWorkBotContext(messages: readonly Message[], signal: AbortSignal, uploadProse?: UploadProse, portableData?: (message: Message) => boolean): Promise<Reason> {
  const copied = new Set<string>();
  for (let offset = 0; offset < messages.length; offset += 100) {
    if (signal.aborted) return null;
    const reason = scanContext(messages.slice(offset, offset + 100), copied, uploadProse, portableData);
    if (reason) return reason;
    if (offset + 100 < messages.length) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return null;
}

export function captureWorkBotContext(messages: readonly Message[], current: () => readonly Message[], sourceIndex: number, uploadProse?: UploadProse, portableData?: (message: Message) => boolean): () => void {
  const versions = messages.map(row => ({ row, text: row.text, kind: row.kind, role: row.role, replyToId: row.replyToId, digest: JSON.stringify(row.digest), sender: JSON.stringify(row.sender), from: JSON.stringify(row.from), data: JSON.stringify(row.dataContext), attachments: row.attachments?.length ?? 0 }));
  return () => {
    const latest = current();
    if (latest.length !== versions.length || latest.some((row, index) => {
      const previous = versions[index];
      return !previous || row !== previous.row || row.text !== previous.text || row.kind !== previous.kind || row.role !== previous.role || row.replyToId !== previous.replyToId || JSON.stringify(row.digest) !== previous.digest || JSON.stringify(row.sender) !== previous.sender || JSON.stringify(row.from) !== previous.from || JSON.stringify(row.dataContext) !== previous.data || (row.attachments?.length ?? 0) !== previous.attachments;
    }) || unsupportedWorkBotContext(latest.slice(0, sourceIndex + 1), uploadProse, portableData)) throw new Error("The conversation context changed during handoff");
  };
}
