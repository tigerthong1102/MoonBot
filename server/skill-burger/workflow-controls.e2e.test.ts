// Run the real saved-workflow editor API, injected agent tool and guarded shell executor in a throwaway workspace.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerArgs, verificationServerEnvironment } from "../../scripts/control-omb.ts";
import type { WorkflowWait } from "../../shared/skill-burger/approval.ts";
import { waitForExit } from "../testing/cleanup.ts";
import { hostTimeout } from "../testing/host-timeout.ts";

it("recovers an approved step after restarting, restricts the review to its chat and executes once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "workflow-review-"));
  const calls = join(dir, "calls.json");
  const plan = (input: unknown) => writeFileSync(calls, JSON.stringify([{ server: "agents", name: "run_workflow", input }]));
  const env = { ...process.env, FAKE_CLAUDE_TOOL_CALLS_FILE: calls, FAKE_CLAUDE_REPLIES: '["Fixture complete."]' };
  const fixture = await launchVerificationServer(env, AbortSignal.timeout(60_000));
  let restarted: ChildProcess | undefined;
  try {
    const { url, dataDir, logPath } = fixture.info;
    async function request<T = unknown>(path: string, method = "GET", body?: unknown, status = 200, token?: string, origin = true) {
      const result = await fetch(url + path, { method, headers: {
        "content-type": "application/json", ...(origin ? { origin: url } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
      const value = await result.json();
      expect(result.status, `${method} ${path}: ${JSON.stringify(value).slice(0, 500)}`).toBe(status);
      return value as T;
    }
    const run = (...args: string[]) => runControlOmb([...args, "--url", url]);
    const { bot } = await request<{ bot: { id: string; threadId: string } }>("/api/bots", "POST", { name: "Approval Fixture" }, 201);
    const turn = async (input: unknown) => {
      plan(input);
      await run("send", "--bot", bot.id, "--task", bot.threadId, "--text", "Run the planned fixture step.");
      expect(await run("wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30")).toMatchObject({ status: "settled" });
    };
    await request(`/api/bots/${bot.id}`, "PATCH", { approvalMode: "full", applyToAllThreads: true });
    const opened = await request<{ code: string }>("/api/auth/pairing", "POST", { label: "Owner device", scopes: ["admin", "client"] });
    const { token: device } = await request<{ token: string }>("/api/auth/pair", "POST", { code: opened.code });
    const name = "human-reviewed-fixture";
    const command = process.platform === "win32" ? "echo reviewed-output" : "printf reviewed-output";
    const { skill } = await request<{ skill: { sha256: string } }>("/api/skill-burgers", "POST", { botId: bot.id, name, workflow: {
      version: 1, args: {}, summary: "Review shell", steps: [{ id: "print", kind: "shell", where: "bot", run: command, label: "Print after review" }],
    } }, 201);
    const changes = { botId: bot.id, sha256: skill.sha256, controls: [{ id: "print", approval: "Review the command" }] };
    await request(`/api/skill-burgers/${name}`, "PATCH", changes);
    await request(`/api/skill-burgers/${name}`, "PATCH", changes, 409);
    const path = `/api/bots/${bot.id}/workflow-approvals?threadId=${bot.threadId}`;
    const waits = async (): Promise<WorkflowWait[]> => (await request<{ waits: WorkflowWait[] }>(path, "GET", undefined, 200, device)).waits;
    await turn({ name });
    const [pause] = await waits();
    expect(pause).toMatchObject({ state: "pending", action: expect.stringContaining(command) });
    const answer = { token: pause!.token, decision: "allow" };
    await request(`/api/bots/${bot.id}/workflow-approvals?threadId=another-chat`, "POST", answer, 404, device);
    await request(path, "POST", answer, 403, undefined, false);
    await turn({ resume: pause!.token, response: "I approve it" });
    expect(await waits()).toMatchObject([{ state: "pending" }]);
    await request(path, "POST", answer, 200, device);
    await request(path, "POST", answer, 200, device);
    await request(path, "POST", { ...answer, decision: "deny" }, 409, device);
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const childEnv = verificationServerEnvironment(env, dataDir, Number(new URL(url).port));
    const log = openSync(logPath, "a", 0o600);
    try { restarted = spawn(process.execPath, verificationServerArgs(childEnv), { cwd: join(import.meta.dirname, "../.."), env: childEnv, stdio: ["ignore", log, log] }); }
    finally { closeSync(log); }
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
    }, { timeout: 30_000 }).toBe(true);
    expect(await waits()).toMatchObject([{ state: "approved", token: pause!.token }]);
    await turn({ resume: pause!.token, response: "Continue" });
    expect(await waits()).toEqual([]);
    await turn({ resume: pause!.token, response: "Duplicate" });
    const { messages } = await request<{ messages: Array<{ tool?: { output?: string } }> }>(`/api/threads/${bot.threadId}/messages?limit=100`);
    const completed = messages.filter((msg) => msg.tool?.output?.includes("The Skill Burger ran:") && msg.tool.output.includes("reviewed-output"));
    expect(completed).toHaveLength(1);
    await turn({ name });
    const [denied] = await waits();
    await request(path, "POST", { token: denied!.token, decision: "deny" }, 200, device);
    expect(await waits()).toEqual([]);
    await request(path, "POST", { token: denied!.token, decision: "allow" }, 409, device);
  } finally {
    if (restarted) await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, hostTimeout(180_000));
