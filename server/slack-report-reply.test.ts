import { describe, expect, it } from "vitest";
import { reportStillPosted, slackReportReply } from "./slack-report-reply.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { TeamSlackMessage, TeamSlackRecord } from "./team-slack.ts";

const auth = { kind: "session", session: { id: "session-a" } } as RequestAuth;
const input: TeamSlackMessage = { id: "x", v: 1, audience: "member", bot: { id: "bot" }, conversationId: null,
  text: "report run1: show source", slack: { workspace: "W", channel: "D", threadTs: "1.0", messageTs: "2.0", user: "U" } };
const find = (_auth: RequestAuth, id: string) => ({ botId: "bot", threadId: "report-thread", messageId: "message-" + id });

describe("Slack automation report replies", () => {
  it("pins the specific published message and rechecks access on each follow-up", () => {
    const first = slackReportReply(input, auth, "member", [], find)!;
    expect(first).toMatchObject({ messageId: "message-run1", text: "show source" });
    const records = [{ person: "member", reportRef: first.reportRef }] as TeamSlackRecord[];
    const follow = { ...input, text: "more", conversationId: "report-thread" };
    expect(slackReportReply(follow, auth, "member", records, find)).toMatchObject({ messageId: "message-run1", text: "more" });
    expect(slackReportReply(follow, auth, "member", records, () => undefined)).toBeNull();
    expect(slackReportReply({ ...follow, text: "report run2: details" }, auth, "member", records, find)).toBeNull();
    expect(slackReportReply({ ...follow, audience: "team" }, auth, "member", records, find)).toBeNull();
    expect(slackReportReply(follow, auth, "other", records, find)).toBeUndefined();
  });
});


it("suppresses delayed and replayed Slack results if the exact report leaves the active conversation", () => {
  const first = slackReportReply(input, auth, "member", [], find)!;
  const record = { botId: first.botId, threadId: first.threadId, reportRef: first.reportRef } as TeamSlackRecord;
  expect(reportStillPosted(record, first, () => [{ id: first.messageId }])).toBe(true);
  expect(reportStillPosted(record, first, () => [{ id: "other-branch" }])).toBe(false);
  expect(reportStillPosted(record, { ...first, messageId: "replacement" }, () => [{ id: "replacement" }])).toBe(false);
  expect(reportStillPosted(record, undefined, () => [{ id: first.messageId }])).toBe(false);
  const older = { ...record, reportRef: { ...first.reportRef, messageId: undefined } };
  expect(reportStillPosted(older, first, () => [])).toBe(false);
});
