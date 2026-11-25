import { botMoveMayRestoreWork } from "./work-bot-move-conflict.ts";
import { serverLine } from "../server-lines.ts";
import { workBotRoutineSnapshot } from "./work-bot-routine-snapshot.ts";
import type { Routine, RoutineManager, RoutineRequestCommit, RoutineRun } from "../routines.ts";
import type { Store } from "../store.ts";

function relatedWorkBotRoutines(store: Store, request: Pick<RoutineRequestCommit, "botId" | "threadId" | "messageId">, links: (threadId: string, botId: string) => import("../work-bot-message-db.ts").WorkBotLink[]) {
  const rows = store.messagesFor(request.threadId);
  const card = rows.find(row => row.id === request.messageId);
  const path = store.activePath(request.threadId);
  const root = card?.requestMessageId ? rows.find(row => row.id === card.requestMessageId && row.role === "user") : path.findLast(row => row.role === "user");
  const handoff = path.findLast(row => row.role === "user" && row.workBotHandoffSource && !row.queueId);
  const source = root?.workBotHandoffSource ?? handoff?.workBotHandoffSource;
  const sourceBotId = source && (source.botId ?? store.botByThread(source.threadId)?.id);
  const related = source ? [{ botId: sourceBotId, threadId: source.threadId }] : path.flatMap(row => {
    const route = row.workBotRouting;
    return route && (route.state === "dispatched" || route.state === "interrupted") && route.targetBotId && route.targetThreadId && route.targetThreadId !== request.threadId ? [{ botId: route.targetBotId, threadId: route.targetThreadId }] : [];
  });
  related.push(...links(request.threadId, request.botId).map(link => (link.sourceBotId === request.botId || (link.targetBotId !== request.botId && link.sourceThreadId === request.threadId)) ? { botId: link.targetBotId, threadId: link.targetThreadId } : { botId: link.sourceBotId, threadId: link.sourceThreadId }));
  return related;
}

export function inspectWorkBotRoutineConflict(store: Store, request: Pick<RoutineRequestCommit, "botId" | "threadId" | "messageId">, routines: readonly Routine[], runs: readonly RoutineRun[], links: (threadId: string, botId: string) => import("../work-bot-message-db.ts").WorkBotLink[] = () => []) {
  const related = relatedWorkBotRoutines(store, request, links).map(link => ({ ...link, moving: Boolean(link.botId && link.botId !== request.botId && botMoveMayRestoreWork(store.bot?.(link.botId))) }));
  return workBotRoutineSnapshot(request.botId, related, routines, runs);
}

export function assertWorkBotRoutineSafe(store: Store, language: (threadId: string) => string | undefined, request: Pick<RoutineRequestCommit, "botId" | "threadId" | "messageId">, routines: readonly Routine[], runs: readonly RoutineRun[], links: (threadId: string, botId: string) => import("../work-bot-message-db.ts").WorkBotLink[] = () => []): void {
  const related = relatedWorkBotRoutines(store, request, links);
  const relatedEntry = (entry: { botId: string; sourceThreadId?: string }) => entry.botId !== request.botId && related.some(link => entry.botId === link.botId || entry.sourceThreadId === link.threadId);
  if (related.some(link => !link.botId || (link.botId !== request.botId && botMoveMayRestoreWork(store.bot?.(link.botId)))) || routines.some(routine => (routine.enabled || routine.heldFor !== undefined) && relatedEntry(routine)) || runs.some(run => relatedEntry(run) && ["queued", "running", "waiting"].includes(run.status))) {
    throw Object.assign(new Error(serverLine(language(request.threadId), "server.workBot.scheduleConflict")), { status: 409, code: "work_bot_schedule_conflict" });
  }
}

type HandoffAutomationSources = {
  routines: Pick<RoutineManager, "hasWorkForHandoff"> | null;
  apps: Pick<import("../app-triggers.ts").AppTriggerManager, "mutationActivity" | "list">;
  webhooks: Pick<import("../webhooks.ts").WebhookManager, "hasWorkForHandoff">;
  calendarCalls: Pick<import("../calendar-calls.ts").CalendarCallManager, "list"> | null;
  waits: Pick<import("../waits.ts").WaitManager, "list">;
};

export function shouldHoldWorkBotHandoff(sources: HandoffAutomationSources, sourceBotId: string, sourceThreadId: string, targetBotId: string): boolean {
  const owns = (entry: { botId: string; sourceThreadId?: string; resultsThreadId?: string; threadId?: string }) =>
    entry.botId === targetBotId || entry.sourceThreadId === sourceThreadId || entry.resultsThreadId === sourceThreadId ||
    entry.threadId === sourceThreadId || (entry.botId === sourceBotId && !entry.sourceThreadId && !entry.resultsThreadId && !entry.threadId);
  return !sources.routines || sources.routines.hasWorkForHandoff(owns) ||
    sources.apps.mutationActivity() !== "no-mutation" || sources.apps.list().some(trigger => trigger.enabled && owns(trigger)) ||
    sources.webhooks.hasWorkForHandoff(owns) ||
    Boolean(sources.calendarCalls?.list().some(call => call.nextRunAt != null && (call.botIds.includes(sourceBotId) || call.botIds.includes(targetBotId)))) ||
    sources.waits.list(sourceBotId).some(wait => wait.threadId === sourceThreadId) || sources.waits.list(targetBotId).length > 0;
}
