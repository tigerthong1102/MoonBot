import { atLeast } from "../shared/bot-access.ts";
import { routineRunVisible } from "./bot-visibility.ts";
import { createHash } from "node:crypto";
import type { RequestAuth } from "./request-auth.ts";
import type { TeamSlackMessage, TeamSlackRecord } from "./team-slack.ts";

export type ReportThread = { botId: string; threadId: string; messageId: string };
export type FindReport = (auth: RequestAuth, runId: string) => ReportThread | undefined;

export function slackReportKey(input: TeamSlackMessage) {
  return input.slack && createHash("sha256").update(JSON.stringify([input.slack.workspace, input.slack.channel, input.slack.threadTs, input.slack.user])).digest("hex");
}

export function slackReportReply(input: TeamSlackMessage, auth: RequestAuth, person: string, records: readonly TeamSlackRecord[], find?: FindReport) {
  const command = /^report\s+([\w-]{1,128})\s*:\s*(\S[\s\S]*)$/iu.exec(input.text.trim());
  const key = slackReportKey(input);
  const previous = key && records.findLast(record => record.person === person && record.reportRef?.key === key)?.reportRef;
  if (!command && !previous) return undefined;
  if (!key || input.audience !== "member" || auth.kind !== "session") return null;
  const runId = command?.[1] ?? (previous && previous.runId);
  if (!runId || (previous && previous.runId !== runId)) return null;
  const target = find?.(auth, runId);
  if (!target || (input.conversationId && input.conversationId !== target.threadId) || ("id" in input.bot && input.bot.id !== target.botId)) return null;
  return { ...target, text: command?.[2] ?? input.text, reportRef: { key, runId, sessionId: auth.session.id } };
}

export function slackReportLookup(runs: () => readonly import("./routines.ts").RoutineRun[], viewer: (auth: RequestAuth) => import("./bot-visibility.ts").VisibleSet): FindReport {
  return (auth, id) => {
    const visible = viewer(auth);
    const run = runs().find(candidate => candidate.id === id && candidate.status === "completed" && routineRunVisible(candidate, visible));
    const report = run?.report;
    if (!run || report?.state !== "posted" || !visible.thread(report.threadId) || !atLeast(visible.level(run.botId), "chat")) return undefined;
    return { botId: run.botId, threadId: report.threadId, messageId: report.messageId };
  };
}
