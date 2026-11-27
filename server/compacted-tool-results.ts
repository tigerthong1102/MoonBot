import { routedWorkMarker } from "./delta-context.ts";
import { allowsTool, type ToolScope } from "../shared/tool-scope.ts";
import { readSpilledToolResult } from "./tool-result-spill.ts";
import { toolResultPrefix } from "./tool-results.ts";
import { digestPromptLine } from "./digest.ts";
import type { Message } from "./store.ts";
import { boundedContextText, MAX_SUMMARY_BYTES, toolReplayLine } from "./context-rebuild.ts";
import { redactSecretsInText } from "./redact.ts";
import { replayToolHistoryEnabled } from "./replay-settings.ts";

function recallableTool(message: Message, scope?: ToolScope) {
  const tool = message.tool;
  if (message.kind !== "activity" || !tool?.itemId || tool.setup || tool.whose || (!tool.output && tool.fullResult === undefined)) return;
  if (scope) {
    const mcp = /^mcp__([a-z][a-z0-9_-]*)__([\w.-]+)$/.exec(tool.name);
    // Other display titles can be commands or normalized MCP aliases. A restricted scope needs an unambiguous identity.
    const identity = mcp ? { kind: "mcp" as const, server: mcp[1]!, name: mcp[2]! }
      : /^[A-Z][a-zA-Z0-9]*$/.test(tool.name) ? { kind: "native" as const, name: tool.name } : undefined;
    if (!identity || !allowsTool(scope, identity)) return;
  }
  return tool;
}

export function summaryWithToolReferences(summary: string, threadId: string, path: readonly Message[], foldedThrough: string, scope?: ToolScope): string {
  const end = path.findIndex(message => message.id === foldedThrough);
  if (end < 0) return summary;
  const references: string[] = [];
  let bytes = 0;
  for (let i = end; i >= 0; i--) {
    const message = path[i]!;
    if (!recallableTool(message, scope)) continue;
    const line = `${JSON.stringify(message.id)} ${toolReplayLine(message.tool!)}`;
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > 1_500) break;
    references.unshift(line);
  }
  if (!references.length) return summary;
  const suffix = `\n\nSaved tool outputs on this branch. Read one with session_search(thread_id=${JSON.stringify(threadId)}, message_id=<id>). Cite the message id.\n${references.join("\n")}`;
  return boundedContextText(summary, MAX_SUMMARY_BYTES - Buffer.byteLength(suffix)) + suffix;
}

/** Preserve the last two turn digests and the saved results available after a native engine compaction. */
export function nativeCompactionContext(branch: readonly Message[], threadId: string, nameFor: (message: Message) => string, recall: boolean, scope?: ToolScope) {
  const recent = branch.filter(m => m.kind === "digest" && m.digest).slice(-2);
  const text = recent.map(m => digestPromptLine(m.digest!, nameFor(m))).join("\n");
  const last = branch.at(-1);
  const context = recall && last ? summaryWithToolReferences(text, threadId, branch, last.id, scope) : text;
  return { context, count: recent.length };
}

export function readCompactedToolOutput(threadId: string, messageId: string, path: readonly Message[], root?: string, scope?: ToolScope) {
  const message = path.find(item => item.id === messageId);
  const tool = message && recallableTool(message, scope);
  if (!message || !tool) return null;
  const spilled = root && message.turnId && tool.fullResult !== undefined
    ? readSpilledToolResult(root, threadId, message.turnId, tool.itemId!) : undefined;
  const output = spilled ?? tool.output;
  if (!output) return null;
  return { threadId, messageId, at: message.at, role: "bot", text: redactSecretsInText(output) };
}

export function sessionReadPage(text: string, offset: number, limit: number) {
  const first = text.charCodeAt(offset);
  const start = first >= 0xdc00 && first <= 0xdfff ? Math.max(0, offset - 1) : offset;
  const page = toolResultPrefix(text.slice(start), limit);
  const next = start + page.length;
  return { text: page, ...(next < text.length ? { nextOffset: next } : {}) };
}

/** Page the same privacy-filtered text that the replayed transcript renders. */
export function sessionReadView(text: string, source: Message | undefined, offset: number) {
  const visible = routedWorkMarker(source ?? {}) ?? text;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > visible.length) return null;
  return sessionReadPage(visible, offset, 8_000);
}

export function toolRecallEnabled(settings: { replayToolHistory?: boolean } | undefined, memoryEnabled: boolean | undefined) {
  return memoryEnabled !== false && replayToolHistoryEnabled(settings);
}
