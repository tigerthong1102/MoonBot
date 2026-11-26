import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchCloudSendFixture, type CloudSendFixture } from "../scripts/testing/cloud-send-fixture.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

it("keeps private Team work in its original chat without exposing it or creating a bot", async () => {
  const engine = `process.env.FAKE_CLAUDE_ROOM_PLAN = process.env.FAKE_CLAUDE_FIXTURE_DIR + "/plan.json";`;
  let fixture: CloudSendFixture | undefined;
  try {
    fixture = await launchCloudSendFixture({ onePasswordToken: `ops_fake-team-${randomBytes(8).toString("hex")}`, team: { id: "team-work-bot-test", name: "Fixture", engine } });
    const team = fixture.team!;
    const owner = (await team.pair({ email: "owner@fixture.test", role: "owner" })).token!;
    const alice = (await team.pair({ email: "alice@fixture.test", role: "member" })).token!;
    const bob = (await team.pair({ email: "bob@fixture.test", role: "member" })).token!;
    const roster = async () => (await team.as(alice, "GET", "/api/bots?messages=0")).body.bots as Array<{ id: string; threadId: string; defaultBot?: { person?: string }; busy?: boolean }>;
    const initial = await roster();
    const main = initial.find(bot => bot.defaultBot?.person === "alice@fixture.test")!;
    const text = "Follow the SYNTHETIC-PRIVATE fixture each week";
    const plan = join(team.home, "plan.json");
    writeFileSync(plan, JSON.stringify({ [main.id]: { script: [{ key: "private-work", match: [text], reply: "Synthetic private work complete." }] } }));
    expect((await team.as(alice, "POST", `/api/bots/${main.id}/messages`, { threadId: main.threadId, text, sendId: randomUUID() })).status).toBe(202);
    await expect.poll(async () => JSON.stringify((await team.as(alice, "GET", `/api/threads/${main.threadId}/messages`)).body).includes("Synthetic private work complete."), { timeout: 60000 }).toBe(true);
    const messages = (await team.as(alice, "GET", `/api/threads/${main.threadId}/messages`)).body.messages as Array<{ card?: { teamSetupRequest?: { workBotOffer?: unknown } } }>;
    expect(messages.some(row => row.card?.teamSetupRequest?.workBotOffer)).toBe(false);
    expect((await roster()).map(bot => bot.id).sort()).toEqual(initial.map(bot => bot.id).sort());
    for (const other of [owner, bob]) {
      expect((await team.as(other, "GET", `/api/threads/${main.threadId}/messages`)).status).toBe(404);
      expect(JSON.stringify((await team.as(other, "GET", "/api/bots?messages=1")).body)).not.toContain("SYNTHETIC-PRIVATE");
    }
    const evidence = `${plan}.evidence.jsonl`;
    expect(existsSync(evidence)).toBe(true);
    expect(readFileSync(evidence, "utf8").trim().split("\n")).toHaveLength(1);
  } finally {
    await fixture?.close();
  }
}, hostTimeout(120000));
