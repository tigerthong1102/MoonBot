import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { hostTimeout } from "../testing/host-timeout.ts";

it("requests approval and delivers a saved hand-off to a teammate", async () => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-workflow-delegate-"));
  const calls = join(root, "calls.json");
  writeFileSync(calls, "[]");
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_TOOL_CALLS_FILE: calls, FAKE_CLAUDE_REPLIES: '["Fixture teammate finished."]' }, AbortSignal.timeout(45_000));
  try {
    const { url } = fixture.info;
    const request = async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(url + path, { method, headers: { origin: url, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
      const data = await response.json() as { messages: unknown[]; outcome?: string };
      expect(response.ok, `${method} ${path}: ${JSON.stringify(data)}`).toBe(true);
      return data;
    };
    const run = (...args: string[]) => runControlOmb([...args, "--url", url]);
    const lead = ((await run("new-bot", "--name", "Lead Fixture")) as { bot: { id: string; activeTaskId: string } }).bot;
    const mate = ((await run("new-bot", "--name", "Peer Fixture")) as { bot: { id: string } }).bot;
    const workflow = { version: 1, summary: "Delegate fixture", args: {}, steps: [{ id: "s1", kind: "delegate", label: "Ask peer", tasks: [{ bot: { id: mate.id, name: "Peer Fixture" }, message: "Inspect fixture only" }] }] };
    await request("/api/skill-burgers", "POST", { botId: lead.id, name: "delegate-fixture", workflow });
    writeFileSync(calls, JSON.stringify([{ server: "agents", name: "run_workflow", input: { name: "delegate-fixture" } }]));
    await run("send", "--bot", lead.id, "--task", lead.activeTaskId, "--text", "Run the delegation fixture");
    const thread = `/api/threads/${lead.activeTaskId}`;
    const deadline = Date.now() + 40_000;
    let card: { requestId: string; subtitle: string } | undefined;
    while (!card && Date.now() < deadline) {
      const messages = (await request(`${thread}/messages?limit=100`)).messages as Array<{ card?: { requestId: string; subtitle: string; tool?: string; answered?: unknown } }>;
      card = messages.map((message) => message.card).find((item) => item?.tool === "Workflow: delegate" && !item.answered);
      if (!card) await delay(100);
    }
    expect(card).toBeDefined();
    expect(card!.subtitle).toContain("Inspect fixture only");
    writeFileSync(calls, "[]");
    expect((await request(`${thread}/respond`, "POST", { requestId: card!.requestId, behavior: "allow" })).outcome).toBe("allowed-once");
    let accepted = false;
    while (!accepted && Date.now() < deadline) {
      const messages = (await request(`${thread}/messages?limit=100`)).messages as unknown[];
      accepted = messages.some((message) => JSON.stringify(message).includes("Peer Fixture") && /Sent to|handed|waiting|receipt/i.test(JSON.stringify(message)));
      if (!accepted) await delay(100);
    }
    expect(accepted).toBe(true);
  } finally {
    await fixture.close();
    rmSync(root, { recursive: true, force: true });
  }
}, hostTimeout(120_000));
