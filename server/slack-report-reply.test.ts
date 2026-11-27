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

it("drops a queued Slack question if its member session expires before dispatch", async () => {
  const { createTeamSlackHost } = await import("./host/team-slack-host.ts");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "startupbot-slack-lane-"));
  let live = true;
  let dispatched = 0;
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const bot = { id: "bot", name: "Bot" };
  const host = createTeamSlackHost({
    cloudHome: { publicOrigin: "https://example.test", machineId: "fixture", bootstrapSecret: "fixture", adminOrigin: "https://example.test" },
    dataDir: dir, owner: () => "member", findReport: find, reportSession: () => live ? auth : undefined,
    reporter: async () => "told", setTimer: () => ({}),
    visibleFor: () => ({ bot: () => true, thread: () => true, level: () => "chat" }),
    store: { botByThread: () => bot, taskByThread: () => ({}), activePath: () => [{ id: "message-run1" }], onChange: () => {} },
    sender: () => undefined, trigger: () => "user", actor: () => ({ admin: false }),
    send: async () => { dispatched++; await gate; throw new Error("Fixture turn ended"); },
  } as unknown as import("./host/team-slack-host.ts").TeamSlackHostDeps)!;
  try {
    const first = host.message(auth, input);
    const second = host.message(auth, { ...input, id: "second" });
    expect(dispatched).toBe(1);
    live = false;
    finish();
    await first;
    expect((await second).body.code).toBe("no_such_conversation");
    expect(dispatched).toBe(1);
  } finally {
    finish();
    rmSync(dir, { recursive: true, force: true });
  }
});
