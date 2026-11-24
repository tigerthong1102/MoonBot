import { expect, it } from "vitest";
import { mayDispatchWorkBot, type WorkBotMember } from "./work-bot-access.ts";

it("rechecks team membership and both bot permissions at dispatch", () => {
  const member: WorkBotMember = { email: "fixture@example.test", role: "member" };
  const from = { visibility: "everyone", access: { everyone: "chat", people: {} } };
  const to = { visibility: "everyone", access: { everyone: "chat", people: {} } };
  expect(mayDispatchWorkBot(true, member, from, to)).toBe(true);
  expect(mayDispatchWorkBot(true, { ...member, leftAt: 1 }, from, to)).toBe(false);
  expect(mayDispatchWorkBot(true, member, from, { ...to, access: { everyone: "view", people: {} } })).toBe(false);
  expect(mayDispatchWorkBot(true, member, { ...from, visibility: "admins" }, to)).toBe(false);
  expect(mayDispatchWorkBot(true, { ...member, role: "admin" }, from, to)).toBe(true);
  expect(mayDispatchWorkBot(false, undefined, from, to)).toBe(true);
});
