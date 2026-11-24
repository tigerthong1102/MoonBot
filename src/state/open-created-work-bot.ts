import { t } from "@/lib/i18n";
import { api } from "./api";
import { readOneBot } from "./bot-read";
import { MESSAGE_PAGE_SIZE } from "./message-history";
import type { Action, AppState, BotAnnouncement } from "./store";

export async function openCreatedWorkBot(id: string, navigationAtDecision: number, deps: {
  revision(): number;
  state(): AppState;
  current(): AppState;
  dispatch(action: Action): void;
  withTaskWrites(bot: BotAnnouncement): BotAnnouncement;
}): Promise<void> {
  if (deps.revision() !== navigationAtDecision) return;
  const state = deps.state();
  const since = state.transcriptGeneration;
  const olderSince = state.olderPageRevision;
  const deletionRevision = state.botDeletionRevision[id] ?? 0;
  const heldAtStart = state.bots.find(item => item.id === id)?.messages ?? [];
  const bot = await readOneBot(id, MESSAGE_PAGE_SIZE);
  if (!bot || bot.hidden || !Array.isArray(bot.messages)) throw new Error(t("serverError.owner.unavailable"));
  if (deps.revision() !== navigationAtDecision) return;
  deps.dispatch({ type: "createdBotSnapshot", bot: deps.withTaskWrites(bot), since, olderSince, deletionRevision, heldAtStart });
  const opened = deps.current();
  if (opened.selectedId === bot.id && opened.activeView === "chat" && opened.bots.some(item => item.id === bot.id && item.threadId === bot.threadId && !item.hidden)) {
    void api(`/api/bots/${bot.id}/read`, { method: "POST", body: JSON.stringify({ threadId: bot.threadId }) }).catch(() => {});
  }
}
