import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";

import { launchCloudSendFixture } from "../../scripts/testing/cloud-send-fixture.ts";
import { hostTimeout } from "../testing/host-timeout.ts";

it("asks the owning team member before a saved workflow executes", async () => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-team-workflow-"));
  const calls = join(root, "calls.json");
  writeFileSync(calls, "[]");
  const fx = await launchCloudSendFixture({ onePasswordToken: `ops_fixture-${randomBytes(8).toString("hex")}`, team: {
    id: "team-workflow-test", name: "Fixture", engine: `process.env.FAKE_CLAUDE_TOOL_CALLS_FILE = ${JSON.stringify(calls)};`,
  } });
  try {
    const team = fx.team!;
    const owner = (await team.pair({ email: "owner@example.test", role: "owner" })).token!;
    const admin = (await team.pair({ email: "admin@example.test", role: "admin" })).token!;
    const rui = (await team.pair({ email: "rui@example.test", role: "member" })).token!;
    const marta = (await team.pair({ email: "marta@example.test", role: "member" })).token!;
    const bots = (await team.as(rui, "GET", "/api/bots")).body.bots as Array<{ id: string; threadId: string; defaultBot?: { person?: string } }>;
    const bot = bots.find((candidate) => candidate.defaultBot?.person === "rui@example.test")!;
    expect(bot).toBeDefined();
    const workflow = { version: 1, summary: "Fixture", args: {}, steps: [{ id: "s1", kind: "shell", label: "Print fixture", run: "printf team-workflow-fixture" }] };
    const saved = await team.as(rui, "POST", "/api/skill-burgers", { botId: bot.id, name: "team-fixture-workflow", workflow, shareConsent: true });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    writeFileSync(calls, JSON.stringify([{ server: "agents", name: "run_workflow", input: { name: "team-fixture-workflow" } }]));
    expect((await team.as(rui, "POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "Run the fixture workflow" })).status).toBe(202);
    let card: { requestId: string; tool: string; subtitle: string } | undefined;
    const end = Date.now() + 40_000;
    while (!card && Date.now() < end) {
      const response = await team.as(rui, "GET", `/api/threads/${bot.threadId}/messages?limit=100`);
      card = response.body.messages?.map((message: { card?: typeof card }) => message.card).find((item: typeof card) => item?.tool === "Workflow: shell");
      if (!card) await delay(100);
    }
    expect(card).toBeDefined();
    expect(card!.subtitle).toContain("printf team-workflow-fixture");
    expect((await team.as(marta, "POST", `/api/threads/${bot.threadId}/respond`, { requestId: card!.requestId, behavior: "allow" })).status).not.toBe(200);
    const allowed = await team.as(rui, "POST", `/api/threads/${bot.threadId}/respond`, { requestId: card!.requestId, behavior: "allow" });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    expect(allowed.body.outcome).toBe("allowed-once");
    let completed = false;
    while (!completed && Date.now() < end) {
      const response = await team.as(rui, "GET", `/api/threads/${bot.threadId}/messages?limit=100`);
      completed = response.body.messages?.some((message: { tool?: { output?: string } }) => message.tool?.output?.includes("team-workflow-fixture")) === true;
      if (!completed) await delay(100);
    }
    expect(completed).toBe(true);
    const ownerBots = (await team.as(owner, "GET", "/api/bots")).body.bots as Array<{ id: string; defaultBot?: { person?: string } }>;
    const ownerBot = ownerBots.find((candidate) => candidate.defaultBot?.person === "owner@example.test")!;
    expect(ownerBot).toBeDefined();
    const shared = { name: "team-shared-fixture", workflow, botId: ownerBot.id, everyChat: true };
    expect((await team.as(owner, "POST", "/api/skill-burgers", shared)).status).toBe(403);
    expect((await team.as(owner, "POST", "/api/skill-burgers", { ...shared, shareConsent: true })).status).toBe(201);
    const visible = await team.as(marta, "GET", "/api/skill-burgers");
    expect(JSON.stringify(visible.body)).toContain("team-shared-fixture");
    expect(JSON.stringify(visible.body)).not.toContain("team-fixture-workflow");
    expect(JSON.stringify(visible.body)).not.toContain(ownerBot.id);
    const indexFile = join(team.home, ".openmausbot", "skills-library", "index.json");
    const index = JSON.parse(readFileSync(indexFile, "utf8")) as Record<string, { source: string; workflowOriginBot?: string }>;
    index["team-shared-fixture"]!.source = `skill-burger:${ownerBot.id}`;
    delete index["team-shared-fixture"]!.workflowOriginBot;
    writeFileSync(indexFile, JSON.stringify(index));
    const adminBots = (await team.as(admin, "GET", "/api/bots")).body.bots as Array<{ id: string; defaultBot?: { person?: string } }>;
    const adminBot = adminBots.find((candidate) => candidate.defaultBot?.person === "admin@example.test")!;
    const botSkills = await team.as(admin, "GET", `/api/bots/${adminBot.id}/skills`);
    expect(botSkills.status).toBe(200);
    expect(JSON.stringify(botSkills.body)).not.toContain(ownerBot.id);
    const library = await team.as(admin, "GET", "/api/skills-library");
    expect(library.status).toBe(200);
    expect(JSON.stringify(library.body)).not.toContain(ownerBot.id);
  } finally {
    await fx.close();
    rmSync(root, { recursive: true, force: true });
  }
}, hostTimeout(120_000));
