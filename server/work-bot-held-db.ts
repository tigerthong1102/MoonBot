import type { DatabaseSync } from "node:sqlite";
import type { Message } from "./store.ts";
import type { WorkBotLink } from "./work-bot-message-db.ts";
import { transferWorkBotFollowups, type WorkBotFollowupClaim } from "./work-bot-followups-db.ts";

export function commitHeldWorkBotContext(deps: { durableTransaction(write: (database: DatabaseSync) => void): void; insert(threadId: string, message: Message): void; setLeaf(threadId: string, id: string): void }, link: WorkBotLink, messages: readonly Message[], expectedSourceLeaf: string | null, claim?: WorkBotFollowupClaim): Message {
  let held: Message | undefined;
  deps.durableTransaction(database => { held = writeHeldWorkBotContext(database, link, messages, expectedSourceLeaf, claim, deps.insert, deps.setLeaf); });
  if (!held) throw new Error("Held work was not committed");
  return held;
}

function writeHeldWorkBotContext(database: DatabaseSync, link: WorkBotLink, messages: readonly Message[], expectedSourceLeaf: string | null, claim: WorkBotFollowupClaim | undefined, insert: (threadId: string, message: Message) => void, setLeaf: (threadId: string, id: string) => void): Message {
  if (!link.sourceBotId || !link.targetBotId || !link.sourceThreadId || !link.targetThreadId || !link.sourceMessageId || link.sourceThreadId === link.targetThreadId || !messages.length) throw new Error("Invalid held work");
  if (messages.some(message => !message.workBotReviewHold || message.requestPending || message.workBotRecoveryPending || (message.workBotCopy && (message.workBotCopy.sourceThreadId !== link.sourceThreadId || message.workBotCopy.requestMessageId !== link.sourceMessageId))) || new Set(messages.map(message => message.id)).size !== messages.length) throw new Error("Invalid held work context");
  const sourceRow = database.prepare("SELECT json FROM messages WHERE thread_id = ? AND id = ? AND role = 'user' AND kind = 'text'").get(link.sourceThreadId, link.sourceMessageId) as { json: string } | undefined;
  if (!sourceRow) throw new Error("Held work source is missing");
  const source = JSON.parse(sourceRow.json) as Message;
  const route = source.workBotRouting;
  if (source.requestCancelled || route?.state !== "dispatching" || route.sourceBotId !== link.sourceBotId || route.targetBotId !== link.targetBotId || route.targetThreadId !== link.targetThreadId) throw new Error("Held work source changed");
  const sourceLeaf = database.prepare("SELECT active_leaf_id FROM thread_state WHERE thread_id = ?").get(link.sourceThreadId) as { active_leaf_id: string | null } | undefined;
  if ((sourceLeaf?.active_leaf_id ?? null) !== expectedSourceLeaf) throw new Error("Held work source changed");
  const request = messages.filter(message => message.workBotHandoffSource?.threadId === link.sourceThreadId && message.workBotHandoffSource.messageId === link.sourceMessageId && message.role === "user" && !message.queueId);
  if (request.length !== 1 || request[0]!.kind !== "text" || request[0]!.requestPending !== false || request[0]!.workBotHandoffSource?.botId !== link.sourceBotId || request[0]!.text !== source.text || request[0]!.sendId !== `workbot-${source.id}`) throw new Error("Held work request changed");
  const sendIds = messages.flatMap(message => message.sendId ? [message.sendId] : []);
  const existingSend = database.prepare("SELECT 1 FROM messages WHERE thread_id = ? AND json_extract(json, '$.sendId') = ? LIMIT 1");
  if (new Set(sendIds).size !== sendIds.length || sendIds.some(id => existingSend.get(link.targetThreadId, id))) throw new Error("Held work request already exists");
  if (claim) {
    if (claim.botId !== link.sourceBotId || claim.sourceThreadId !== link.sourceThreadId || claim.sourceMessageId !== link.sourceMessageId || !claim.queueIds.length || new Set(claim.queueIds).size !== claim.queueIds.length || messages.filter(message => message.queueId).length !== claim.queueIds.length || claim.queueIds.some(id => messages.filter(message => message.queueId === id && message.role === "user" && message.kind === "text" && message.workBotHandoffSource?.threadId === link.sourceThreadId && message.workBotHandoffSource.messageId === link.sourceMessageId && message.workBotHandoffSource.botId === link.sourceBotId).length !== 1)) throw new Error("Invalid queued held work");
    transferWorkBotFollowups(database, link.targetThreadId, messages, claim);
  } else if (messages.some(message => message.queueId)) throw new Error("Invalid queued held work");
  const pending = database.prepare("SELECT 1 FROM chat_followups WHERE kind = 'bot' AND owner_id = ? AND thread_id = ? AND status = 'pending' AND json_extract(payload, '$.workBotOfferSource') = ? LIMIT 1").get(link.sourceBotId, link.sourceThreadId, link.sourceMessageId);
  if (pending) throw new Error("Queued followups require a durable transfer");
  const leaf = database.prepare("SELECT active_leaf_id FROM thread_state WHERE thread_id = ?").get(link.targetThreadId) as { active_leaf_id: string | null } | undefined;
  if ((messages[0]!.parentId ?? null) !== (leaf?.active_leaf_id ?? null) || messages.slice(1).some((message, index) => message.parentId !== messages[index]!.id)) throw new Error("Held work destination changed");
  const existing = database.prepare("SELECT 1 FROM messages WHERE thread_id = ? AND id = ?");
  if (messages.some(message => existing.get(link.targetThreadId, message.id))) throw new Error("Held work destination message already exists");
  database.prepare("INSERT INTO work_bot_links (source_bot_id, source_thread_id, source_message_id, target_bot_id, target_thread_id) VALUES (?, ?, ?, ?, ?)").run(link.sourceBotId, link.sourceThreadId, link.sourceMessageId, link.targetBotId, link.targetThreadId);
  const held: Message = { ...source, requestPending: false, workBotRouting: { ...route, state: "held_for_review" } };
  database.prepare("UPDATE messages SET json = ? WHERE thread_id = ? AND id = ?").run(JSON.stringify(held), link.sourceThreadId, link.sourceMessageId);
  for (const message of messages) insert(link.targetThreadId, message);
  setLeaf(link.targetThreadId, messages[messages.length - 1]!.id);
  return held;
}
