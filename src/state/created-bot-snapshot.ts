import type { Action, AppState, Bot } from "./store";
import { foldSnapshotOntoStreamed } from "./room-frames";

export function createdBotSnapshot(
  state: AppState,
  action: Extract<Action, { type: "createdBotSnapshot" }>,
  reducer: (state: AppState, action: Action) => AppState,
  updateBot: (state: AppState, botId: string, update: (bot: Bot) => Bot) => AppState,
): AppState {
  const { bot, since, olderSince, deletionRevision, heldAtStart } = action;
  const current = state.bots.find(item => item.id === bot.id);
  if ((state.botDeletionRevision[bot.id] ?? 0) !== deletionRevision || current?.hidden) return state;
  if ((state.transcriptGeneration[bot.threadId] ?? 0) !== (since[bot.threadId] ?? 0)) return state;
  if (!current) return reducer(reducer(state, { type: "botPatched", bot }), { type: "select", id: bot.id });
  if (current.threadId !== bot.threadId) return state;
  if ((state.olderPageRevision[bot.threadId] ?? 0) !== (olderSince[bot.threadId] ?? 0) || state.loadingOlder[bot.threadId]) return reducer(state, { type: "select", id: bot.id });
  const messages = foldSnapshotOntoStreamed(current.messages, new Set(heldAtStart), bot.messages ?? []);
  const snapshotIds = new Set((bot.messages ?? []).map(message => message.id));
  const heldIds = new Set(heldAtStart.map(message => message.id));
  const streamedLeaf = current.activeLeafId && !heldIds.has(current.activeLeafId) && !snapshotIds.has(current.activeLeafId) && messages.some(message => message.id === current.activeLeafId);
  let activeLeafId = streamedLeaf ? current.activeLeafId : bot.activeLeafId;
  for (const message of messages) {
    if (!snapshotIds.has(message.id) && message.parentId === activeLeafId) activeLeafId = message.id;
  }
  const updated = updateBot(state, bot.id, previous => ({ ...previous, messages, activeLeafId, hasMore: bot.hasMore }));
  return reducer(updated, { type: "select", id: bot.id });
}
