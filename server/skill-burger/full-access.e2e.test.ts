import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../../scripts/control-omb.ts";
import { hostTimeout } from "../testing/host-timeout.ts";

it("runs under the existing Full access grant without opening a new permission card", async () => {
  const calls = [{ server: "agents", name: "run_workflow", input: { name: "full-fixture" } }];
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_TOOL_CALLS: JSON.stringify(calls), FAKE_CLAUDE_REPLIES: '["Fixture complete."]' }, AbortSignal.timeout(45_000));
  try {
    const { url } = fixture.info;
    const request = async (path: string, method = "GET", body?: unknown) => {
      const response = await fetch(url + path, { method, headers: { origin: url, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
      const data = await response.json();
      expect(response.ok, `${method} ${path}: ${JSON.stringify(data)}`).toBe(true);
      return data;
    };
    const run = (...args: string[]) => runControlOmb([...args, "--url", url]);
    const bot = ((await run("new-bot", "--name", "Full Fixture")) as { bot: { id: string; activeTaskId: string } }).bot;
    await request(`/api/bots/${bot.id}`, "PATCH", { approvalMode: "full", applyToAllThreads: true });
    const command = process.platform === "win32" ? "echo full-fixture" : "printf full-fixture";
    await request("/api/skill-burgers", "POST", { botId: bot.id, name: "full-fixture", workflow: { version: 1, summary: "Full fixture", args: {}, steps: [{ id: "s1", kind: "shell", label: "Print", run: command, where: "bot" }] } });
    await run("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Run the fixture");
    const outcome = await run("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30") as { status: string };
    expect(outcome.status).toBe("settled");
    const { messages } = await request(`/api/threads/${bot.activeTaskId}/messages?limit=100`) as { messages: Array<{ card?: { tool?: string }; tool?: { output?: string } }> };
    expect(messages.some((message) => message.card?.tool === "Workflow: shell")).toBe(false);
    expect(messages.some((message) => message.tool?.output?.includes("full-fixture") && message.tool.output.includes("The Skill Burger ran:"))).toBe(true);
  } finally {
    await fixture.close();
  }
}, hostTimeout(120_000));
