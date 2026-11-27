import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { InboxRow, InboxView } from "../../../shared/inbox";
import type { TodayLine, TodayReport } from "../../../shared/today";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { api, openThread, useStore } from "@/state/store";
import { closeInbox } from "@/state/inbox";
import { AttentionThreadRows, attentionJumpAction, crossBotAttentionThreads } from "../SidebarBotActivity";
import { NeedsYouLine } from "../TeamOwner";
import { TodayTaskDetails } from "./TodayTaskDetails";
import { InboxRowItem } from "./InboxRow";
import { rowsIn } from "./inbox-view";
import { useInboxActions } from "./use-inbox-actions";

function TodaySection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="border-t border-hairline/40 px-2 py-2">
    <h3 className="px-2 py-1 text-[13px] font-medium text-ink-secondary">{title}</h3>
    {children}
  </section>;
}

export function Today({ view, now, onOpen }: { view: InboxView | null; now: number; onOpen: (row: InboxRow) => void }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const { run } = useInboxActions(view);
  const [report, setReport] = useState<TodayReport | null>(null);
  const [error, setError] = useState(false);
  const since = new Date(now).setHours(0, 0, 0, 0);
  useEffect(() => {
    let current = true;
    api<TodayReport>(`/api/today?since=${since}`, { background: true }).then((value) => {
      if (current) { setReport(value); setError(false); }
    }, () => {
      if (current) setError(true);
    });
    return () => { current = false; };
  }, [since, now]);

  const waiting = rowsIn(view, "needs-you");
  const waitingThreads = new Set(waiting.map((row) => row.origin?.threadId));
  const needs = report?.needsYou.filter((item) => item.threadId === undefined || !waitingThreads.has(item.threadId)) ?? [];
  const blocked = report?.lines.filter((line) => !line.ok && line.routineId) ?? [];
  const completed = report?.lines.filter((line) => line.ok && (line.threadId || line.routineId)) ?? [];
  const continued = crossBotAttentionThreads(state.bots, state.pendingQueued, undefined, state.groups)
    .filter(({ task }) => !task.inbox && !waitingThreads.has(task.threadId) && !needs.some((item) => item.threadId === task.threadId));
  const actionableChats = new Set(continued.map(({ task }) => task.threadId));
  const interrupted = (report?.lines ?? []).filter((line) => {
    if (line.ok || line.routineId || !line.threadId || actionableChats.has(line.threadId)
      || waitingThreads.has(line.threadId) || needs.some((item) => item.threadId === line.threadId)) return false;
    actionableChats.add(line.threadId);
    return true;
  });
  const jump = (line: TodayLine) => {
    closeInbox();
    if (line.routineId && !line.ok && state.routines.some((routine) => routine.id === line.routineId)) {
      dispatch({ type: "showRoutines", routineId: line.routineId, botId: line.botId, runId: line.id });
    } else if (line.threadId) {
      openThread(dispatch, { botId: line.botId, threadId: line.threadId }, state, showThreads);
    } else if (line.routineId) {
      dispatch({ type: "showRoutines", routineId: line.routineId, botId: line.botId, runId: line.id });
    }
  };
  const work = (lines: TodayLine[]) => lines.map((line) => {
    const task = state.bots.find(bot => bot.id === line.botId)?.tasks?.find(row => row.threadId === line.threadId);
    if (task?.snoozedUntil === 0 || (task?.snoozedUntil ?? 0) > now) return null;
    return <div key={line.id}><button type="button" disabled={!line.threadId && !state.routines.some((routine) => routine.id === line.routineId)} onClick={() => jump(line)}
    className="block w-full rounded-md px-2 py-1.5 text-start enabled:hover:bg-raised">
    <span className="block break-words text-[13px] text-ink">{line.title || state.bots.find((bot) => bot.id === line.botId)?.name || t("needsYou.aBot")}</span>
    {line.error && <span className="block break-words text-[12px] text-ink-secondary">{line.error}</span>}
  </button>{task && <TodayTaskDetails key={task.threadId} task={task} botId={line.botId} />}</div>;
  });
  return <>
    {(waiting.length > 0 || needs.length > 0) && <TodaySection title={t("inbox.waitsOnYou")}>
      <div role="list">{waiting.map((row) => <InboxRowItem key={row.id} row={row} now={now} onOpen={onOpen} onAction={run} />)}</div>
      {needs.map((item) => <NeedsYouLine key={item.id} item={item} onOpened={closeInbox} menuItem={false} />)}
    </TodaySection>}
    {blocked.length > 0 && <TodaySection title={t("today.failed")}>{work(blocked)}</TodaySection>}
    {completed.length > 0 && <TodaySection title={t("today.completed")}>{work(completed)}</TodaySection>}
    {(continued.length > 0 || interrupted.length > 0) && <TodaySection title={t("today.continue")}>
      <AttentionThreadRows inset entries={continued} onJump={(entry) => { closeInbox(); dispatch(attentionJumpAction(entry)); }} />
      {work(interrupted)}
    </TodaySection>}
    <div role="status" className="px-4 py-3 text-[13px] text-ink-secondary">
      {error ? t("today.loadError") : !report ? t("mcp.loading")
        : !waiting.length && !needs.length && !blocked.length && !completed.length && !continued.length && !interrupted.length ? t("today.empty") : null}
    </div>
  </>;
}
