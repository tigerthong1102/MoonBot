import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { onCase, workflowSchema, type Workflow } from "../../shared/skill-burger/format.ts";
import { draftWorkflow } from "../../shared/skill-burger/draft.ts";
import { createRunStates } from "./run-state.ts";
import { argEnv, fillPrompt, reviewAction, resolve, resumeRun, runArgs, startRun, type ExecResult, type RunDeps, type RunState, type StepExecutors } from "./runner.ts";
import { createExecutors } from "./executors.ts";
import { runText } from "../drivers/agents-workflow-tool.ts";

const app = (id: string, tool: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, kind: "app" as const, app: tool.split("_")[0]!.toLowerCase(), tool, label: tool, args, ...extra });
const wf = (steps: unknown[], args: Workflow["args"] = {}): Workflow => {
  const checked = workflowSchema.safeParse({ version: 1, summary: "Test burger", args, steps });
  if (!checked.success) throw new Error(checked.error.message);
  return checked.data;
};

function harness(handlers: Partial<StepExecutors> = {}) {
  const calls: Array<{ kind: string; input: unknown }> = [];
  const events: string[] = [];
  const saved: RunState[] = [];
  const ok = (output: unknown): Promise<ExecResult> => Promise.resolve({ ok: true, output });
  const exec: StepExecutors = {
    shell: handlers.shell ?? ((input) => { calls.push({ kind: "shell", input }); return ok(""); }),
    app: handlers.app ?? ((input) => { calls.push({ kind: "app", input }); return ok({}); }),
    browser: handlers.browser ?? ((input) => { calls.push({ kind: "browser", input }); return ok("opened"); }),
    file: handlers.file ?? ((input) => { calls.push({ kind: "file", input }); return ok("written"); }),
  };
  const deps: RunDeps = {
    exec,
    events: { started: (_run, _name, step) => events.push(`start ${step.id}`), ended: (_run, _name, step, result) => events.push(`${result.state} ${step.id}`) },
    save: (state) => { saved.push(structuredClone(state)); },
  };
  const start = (workflow: Workflow, args?: Record<string, unknown>) => startRun({ name: "test-burger", botId: "bot-1", threadId: "t1", sha256: "x", workflow, ...(args ? { args } : {}) }, deps);
  return { calls, events, saved, deps, start };
}

describe("running a Skill Burger", () => {
  it("ends the failed step when an executor throws and does not run the next step", async () => {
    const h = harness({ app: async () => { throw new Error("fixture executor failure"); } });
    const result = await h.start(wf([app("s1", "GMAIL_FETCH_EMAILS", {}), app("s2", "GMAIL_SEND_EMAIL", {})]));
    expect(result).toMatchObject({ ok: false, error: { type: "step_failed", message: expect.stringContaining("fixture executor failure"), step: "s1" } });
    expect(h.events).toEqual(["start s1", "failed s1"]);
  });
  it("replays each recorded batch result with the paths used by later actions", async () => {
    const savedId = "recorded-id-123";
    const batch = { data: { results: [{ response: { data: { messages: [{ id: savedId }] } } }, { response: { data: { rows: ["recorded-row-456"] } } }] } };
    const draft = draftWorkflow([
      { id: "u", role: "user", kind: "text", text: "Forward the message" },
      { id: "batch", role: "bot", kind: "activity", tool: { name: "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", ok: true, input: JSON.stringify({ tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }, { tool_slug: "GOOGLESHEETS_BATCH_GET", arguments: {} }] }), output: JSON.stringify(batch) } },
      { id: "forward", role: "bot", kind: "activity", tool: { name: "mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL", ok: true, input: JSON.stringify({ tools: [{ tool_slug: "GMAIL_FORWARD_MESSAGE", arguments: { message_id: savedId, row: "recorded-row-456" } }] }) } },
    ])!;
    const sent: Array<Record<string, unknown>> = [];
    const exec = createExecutors({ botId: "fixture", cwd: tmpdir(), internal: async (_kind, _path, raw) => {
      const call = (raw as { params: { arguments: { tools: Array<{ tool_slug: string; arguments: Record<string, unknown> }> } } }).params.arguments.tools[0]!;
      sent.push(call.arguments);
      const data = call.tool_slug === "GMAIL_FETCH_EMAILS" ? { messages: [{ id: "new-message-id" }] } : { rows: ["new-row-789"] };
      return { ok: true, body: { result: { content: [{ type: "text", text: JSON.stringify({ successful: true, data: { results: [{ tool_slug: call.tool_slug, response: { successful: true, data } }] } }) }] } } };
    } });
    expect(await harness({ app: exec.app }).start(draft.workflow)).toMatchObject({ status: "ok" });
    expect(sent.at(-1)).toMatchObject({ message_id: "new-message-id", row: "new-row-789" });
  });
  it("passes a recorded nested app result into a later app action", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const exec = createExecutors({ botId: "fixture", cwd: tmpdir(), internal: async (_kind, _path, raw) => {
      const frame = raw as { params: { arguments: { tools: Array<{ tool_slug: string; arguments: Record<string, unknown> }> } } };
      const call = frame.params.arguments.tools[0]!;
      sent.push(call.arguments);
      const data = call.tool_slug === "GMAIL_FETCH_EMAILS" ? { messages: [{ id: "fixture-id" }] } : { sent: true };
      return { ok: true, body: { result: { content: [{ type: "text", text: JSON.stringify({ successful: true, data: { results: [{ tool_slug: call.tool_slug, response: { successful: true, data } }] } }) }] } } };
    } });
    const h = harness({ app: exec.app });
    const workflow = wf([app("s1", "GMAIL_FETCH_EMAILS", {}), app("s2", "GMAIL_FORWARD_MESSAGE", { message_id: { $step: "s1", path: "data.results.0.response.data.messages.0.id" } })]);
    expect(await h.start(workflow)).toMatchObject({ status: "ok" });
    expect(sent[1]).toEqual({ message_id: "fixture-id" });
  });
  it("passes plain app results to the next recorded action", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const exec = createExecutors({ botId: "fixture", cwd: tmpdir(), internal: async (_kind, _path, raw) => {
      const frame = raw as { params: { arguments: { tools: Array<{ tool_slug: string; arguments: Record<string, unknown> }> } } };
      const call = frame.params.arguments.tools[0]!;
      sent.push(call.arguments);
      const data = call.tool_slug === "GMAIL_FETCH_EMAILS" ? { messages: [{ messageId: "fixture-id" }] } : { sent: true };
      return { ok: true, body: { result: { content: [{ type: "text", text: JSON.stringify({ successful: true, data: { results: [{ tool_slug: call.tool_slug, response: { successful: true, data } }] } }) }] } } };
    } });
    const h = harness({ app: exec.app });
    const workflow = wf([app("s1", "gmail.search_emails", { query: "invoice" }), app("s2", "GMAIL_FORWARD_MESSAGE", { message_id: { $step: "s1", path: "messages.0.messageId" } })]);
    expect(await h.start(workflow)).toMatchObject({ status: "ok" });
    expect(sent[1]).toEqual({ message_id: "fixture-id" });
  });

  it("retains a checked step's output for the following step", async () => {
    const calls: Record<string, unknown>[] = [];
    const h = harness({ app: async (input) => { calls.push(input.args); return { ok: true, output: { id: "fixture-id" } }; } });
    const workflow = wf([app("s1", "GMAIL_FETCH_EMAILS", {}, { check: true }), app("s2", "GMAIL_SEND_EMAIL", { message_id: { $step: "s1", path: "id" } })]);
    const paused = await h.start(workflow);
    expect(paused.requiresInput?.type).toBe("check");
    const state = h.saved.at(-1)!;
    const done = await resumeRun(state, "pass", h.deps);
    expect(done).toMatchObject({ status: "ok" });
    expect(state.results.s1?.output).toEqual({ id: "fixture-id" });
    expect(calls[1]).toEqual({ message_id: "fixture-id" });
  });

  it("hands previously saved interpreter source with substituted inputs to the bot", async () => {
    const h = harness();
    const result = await h.start(wf([{ id: "s1", kind: "shell", label: "Write report", run: `python3 -c "open('$OMB_ARG_FILE','w').write('ok')"` }], { file: { default: "O'Reilly.csv" } }));
    expect(result).toMatchObject({ status: "needs_input", requiresInput: { type: "ai_step", step: "s1" } });
    expect(JSON.parse(result.requiresInput!.input!)).toMatchObject({ env: { OMB_ARG_FILE: "O'Reilly.csv" } });
    expect(h.calls).toHaveLength(0);
  });

  it("hands VM commands to the normal bot tools rather than starting an uncancellable replay", async () => {
    const h = harness();
    const result = await h.start(wf([{ id: "s1", kind: "shell", label: "VM step", where: "vm", shell: "bash", run: 'printf %s "$OMB_ARG_SITE"' }], { site: { default: "example.test" } }));
    expect(result).toMatchObject({ status: "needs_input", requiresInput: { type: "ai_step", step: "s1" } });
    expect(result.requiresInput?.input).toContain("example.test");
    expect(JSON.parse(result.requiresInput!.input!)).toMatchObject({ shell: "bash" });
    expect(h.calls).toHaveLength(0);
  });

  it("identifies the chosen case after a handed decision", async () => {
    const h = harness();
    const workflow = wf([{ id: "d1", kind: "decide", label: "Pick", cases: ["support", "sales"], prompt: "Choose" }]);
    await h.start(workflow);
    const result = await resumeRun(h.saved.at(-1)!, "support", h.deps);
    expect(result).toMatchObject({ requiresInput: { type: "missing_case", step: "d1" }, steps: [{ id: "d1", case: "support" }] });
    expect(runText(JSON.parse(JSON.stringify(result)))).toContain('Workflow case: {"step":"d1","case":"support"}');
  });

  it.each(["vm", "yourComputer"])("opens a %s desktop browser in its original environment", async (where) => {
    const h = harness();
    const result = await h.start(wf([{ id: "s1", kind: "browser", label: "Open", action: "open", where, url: { $arg: "site" } }], { site: { default: "https://example.test" } }));
    expect(result).toMatchObject({ status: "needs_input", requiresInput: { type: "ai_step", input: "https://example.test" } });
    expect(h.calls).toHaveLength(0);
  });

  it("hands the complete local-computer command and resolved inputs to the bot", async () => {
    const h = harness();
    const result = await h.start(wf([{ id: "s1", kind: "shell", label: "Write", where: "yourComputer", run: 'printf %s "$OMB_ARG_SITE" > file.txt', cwd: "reports", stdin: { $arg: "site" } }], { site: { default: "example.test" } }));
    expect(result).toMatchObject({ status: "needs_input", requiresInput: { type: "ai_step" } });
    expect(JSON.parse(result.requiresInput!.input!)).toMatchObject({ command: 'printf %s "$OMB_ARG_SITE" > file.txt', cwd: "reports", stdin: "example.test", env: { OMB_ARG_SITE: "example.test" } });
    expect(h.calls).toHaveLength(0);
  });

  it("hands commands with an unknown interpreter to the bot", async () => {
    const h = harness();
    const result = await h.start(wf([{ id: "s1", kind: "shell", label: "Write", shell: "unknown", run: "echo {one,two} > out.txt" }]));
    expect(result).toMatchObject({ status: "needs_input", requiresInput: { type: "ai_step" } });
    expect(result.requiresInput!.input).toContain("{one,two}");
    expect(h.calls).toHaveLength(0);
  });

  it("enforces saved checks on AI handoffs before running the next action", async () => {
    const h = harness();
    const checked = wf([{ id: "s1", kind: "ai", label: "Classify", deterministic: false, prompt: "Classify", check: { says: "good", rule: { op: "eq", value: "good" } } }, app("s2", "GMAIL_SEND_EMAIL", {})]);
    await h.start(checked);
    const refused = await resumeRun(h.saved.at(-1)!, "bad", h.deps);
    expect(refused).toMatchObject({ ok: false, error: { type: "step_failed" } });
    expect(h.calls).toHaveLength(0);
    const manual = wf([{ id: "s1", kind: "ai", label: "Draft", deterministic: false, prompt: "Draft", check: true }, app("s2", "GMAIL_SEND_EMAIL", {})]);
    await h.start(manual);
    const needsCheck = await resumeRun(h.saved.at(-1)!, "fixture draft", h.deps);
    expect(needsCheck).toMatchObject({ status: "needs_input", requiresInput: { type: "check", input: "fixture draft" } });
    expect(h.calls).toHaveLength(0);
    expect(await resumeRun(h.saved.at(-1)!, "pass", h.deps)).toMatchObject({ status: "ok" });
    expect(h.calls).toHaveLength(1);
  });
  it("starts the step timeout only after the person approves the action", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.deps.actionExec = h.deps.exec;
      h.deps.authorizationExec = { ...h.deps.exec, shell: async () => { await new Promise((resolve) => setTimeout(resolve, 3_000)); return { ok: true, output: null }; } };
      const running = h.start(wf([{ id: "s1", kind: "shell", label: "Action", run: "true", timeoutMs: 1_000 }]));
      await vi.advanceTimersByTimeAsync(3_001);
      expect(await running).toMatchObject({ ok: true, status: "ok" });
      expect(h.calls).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it("pipes app results and fills command arguments", async () => {
    const h = harness({
      app: async (input) => {
        h.calls.push({ kind: "app", input });
        return input.tool === "GMAIL_FETCH_EMAILS" ? { ok: true, output: { messages: [{ id: "m-42" }] } } : { ok: true, output: { sent: true } };
      },
    });
    const workflow = wf([
      app("s1", "GMAIL_FETCH_EMAILS", { query: { $arg: "query" } }),
      app("s2", "GMAIL_FORWARD_MESSAGE", { message_id: { $step: "s1", path: "messages.0.id" }, to: { $arg: "to" } }),
      { id: "s3", kind: "shell", label: "Archive", run: 'echo "$OMB_ARG_TO"', where: "bot" },
    ], { query: { default: "invoice" }, to: { default: "a@example.com" } });
    const result = await h.start(workflow, { to: "priya@example.com", nope: "ignored" });
    expect(result).toMatchObject({ ok: true, status: "ok" });
    expect(h.calls.map((call) => call.kind)).toEqual(["app", "app", "shell"]);
    expect(h.calls[0]!.input).toMatchObject({ tool: "GMAIL_FETCH_EMAILS", args: { query: "invoice" } });
    expect(h.calls[1]!.input).toMatchObject({ args: { message_id: "m-42", to: "priya@example.com" } });
    expect(h.calls[2]!.input).toMatchObject({ command: 'echo "$OMB_ARG_TO"', where: "bot", env: { OMB_ARG_QUERY: "invoice", OMB_ARG_TO: "priya@example.com" } });
    expect(h.events).toEqual(["start s1", "done s1", "start s2", "done s2", "start s3", "done s3"]);
  });

  it("stops at the first failure, names the step, and runs nothing after it", async () => {
    const h = harness({ app: async () => ({ ok: false, error: "403 the sheet is not shared with you" }) });
    const result = await h.start(wf([app("s1", "GOOGLESHEETS_BATCH_GET", {}), { id: "s2", kind: "file", label: "Write notes", path: "n.md", content: "x" }]));
    expect(result).toMatchObject({ ok: false, error: { type: "step_failed", step: "s1" } });
    expect(result.error!.message).toContain("403 the sheet is not shared with you");
    expect(h.calls).toEqual([]);
    expect(h.events).toEqual(["start s1", "failed s1"]);
  });

  it("does not offer to repeat an action whose outcome is uncertain", async () => {
    const h = harness({ app: async () => ({ ok: false, error: "connection lost" }) });
    const result = await h.start(wf([app("s1", "GMAIL_SEND_EMAIL", {})]));
    expect(result.error?.message).toContain("Check the action's result before trying again");
    expect(result.error?.resumeToken).toBeUndefined();
    expect(h.saved).toHaveLength(0);
  });

  it("hands file writes to the bot's normal tools when a run requires guarded actions", async () => {
    const h = harness();
    h.deps.fileViaBot = true;
    const result = await h.start(wf([{ id: "s1", kind: "file", label: "Write notes", path: "notes/a.txt", content: "fixture data" }]));
    expect(result).toMatchObject({ status: "needs_input", requiresInput: { type: "ai_step", step: "s1" } });
    expect(result.requiresInput?.prompt).toContain("normal file-writing tool");
    expect(result.requiresInput?.input).toContain("fixture data");
    expect(h.calls).toEqual([]);
    const escape = await h.start(wf([{ id: "s1", kind: "file", label: "Escape", path: "../outside.txt", content: "data" }]));
    expect(escape).toMatchObject({ ok: false, error: { type: "step_failed" } });
    expect(h.calls).toEqual([]);
  });

  it("stops a step past its time limit, and a step whose output is too large", async () => {
    vi.useFakeTimers();
    try {
      const slow = harness({ shell: (input) => new Promise((done) => input.signal.addEventListener("abort", () => done({ ok: false, error: "killed" }))) });
      const running = slow.start(wf([{ id: "s1", kind: "shell", label: "Slow", run: "sleep 999", timeoutMs: 2_000 }]));
      await vi.advanceTimersByTimeAsync(2_001);
      expect(await running).toMatchObject({ ok: false, error: { type: "timeout", step: "s1" } });
    } finally {
      vi.useRealTimers();
    }
    const big = harness({ shell: async () => ({ ok: false, error: "output went over 512 KB", tooLarge: true }) });
    expect(await big.start(wf([{ id: "s1", kind: "shell", label: "Big", run: "yes" }]))).toMatchObject({ ok: false, error: { type: "output_too_large" } });
  });

  it("hands an AI step to the bot with its piped input, marked as judgement, then goes on once it answers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "burger-runs-"));
    const states = createRunStates(dir);
    const h = harness({ app: async (input) => { h.calls.push({ kind: "app", input }); return { ok: true, output: { rows: [["West", 40]] } }; } });
    h.deps.save = (state) => states.save(state);
    const workflow = wf([
      app("s1", "GOOGLESHEETS_BATCH_GET", {}),
      { id: "s2", kind: "ai", deterministic: false, label: "Write the body", prompt: "Write a short summary.", input: { $step: "s1" }, example: "Revenue is up." },
      app("s3", "GMAIL_SEND_EMAIL", { body: { $step: "s2" } }),
    ]);
    const paused = await h.start(workflow);
    expect(paused).toMatchObject({ ok: true, status: "needs_input", requiresInput: { type: "ai_step", step: "s2", example: "Revenue is up." } });
    expect(paused.requiresInput!.input).toBe('{"rows":[["West",40]]}');
    const token = paused.requiresInput!.resumeToken;
    expect(states.take(token, "another-bot", "t1")).toBeNull();
    expect(states.take(token, "bot-1", "another-thread")).toBeNull();
    const state = states.take(token, "bot-1", "t1")!;
    expect(states.take(token, "bot-1", "t1")).toBeNull();
    const done = await resumeRun(state, "West sold 40.", h.deps);
    expect(done).toMatchObject({ ok: true, status: "ok" });
    expect(h.calls[1]!.input).toMatchObject({ tool: "GMAIL_SEND_EMAIL", args: { body: "West sold 40." } });
  });

  it("skips a step whose condition doesn't hold", async () => {
    const h = harness({ app: async (input) => { h.calls.push({ kind: "app", input }); return { ok: true, output: { messages: [] } }; } });
    const result = await h.start(wf([
      app("s1", "GMAIL_FETCH_EMAILS", {}),
      app("s2", "GMAIL_SEND_EMAIL", {}, { when: { $step: "s1", path: "messages.0", op: "exists" } }),
    ]));
    expect(result).toMatchObject({ ok: true, status: "ok", steps: [{ id: "s1", state: "done" }, { id: "s2", state: "skipped" }] });
    expect(h.calls).toHaveLength(1);
  });
});

describe("cases", () => {
  const forked = (rules = true) => wf([
    app("s1", "GMAIL_FETCH_EMAILS", {}),
    {
      id: "d1", kind: "decide", label: "What kind of email", cases: ["support", "sales", "other"],
      ...(rules ? { rules: [{ $step: "s1", path: "label", op: "eq", value: "help", case: "support" }, { $step: "s1", path: "label", op: "eq", value: "buy", case: "sales" }], otherwise: "other" } : { prompt: "Is this support or sales?", input: { $step: "s1" } }),
    },
    { ...app("s2", "LINEAR_CREATE_ISSUE", {}), when: onCase("d1", "support") },
    { ...app("s3", "HUBSPOT_CREATE_DEAL", {}), when: onCase("d1", "sales") },
    app("s4", "SLACK_SEND_MESSAGE", {}),
  ]);

  it("takes only the chosen case's steps by rule, and marks the others not taken", async () => {
    const h = harness({ app: async (input) => { h.calls.push({ kind: "app", input }); return { ok: true, output: input.tool === "GMAIL_FETCH_EMAILS" ? { label: "help" } : {} }; } });
    const result = await h.start(forked());
    expect(result.steps).toEqual([
      { id: "s1", label: "GMAIL_FETCH_EMAILS", state: "done" },
      { id: "d1", label: "What kind of email", state: "done", case: "support" },
      { id: "s2", label: "LINEAR_CREATE_ISSUE", state: "done" },
      { id: "s3", label: "HUBSPOT_CREATE_DEAL", state: "not_taken" },
      { id: "s4", label: "SLACK_SEND_MESSAGE", state: "done" },
    ]);
    expect(h.calls.map((call) => (call.input as { tool: string }).tool)).toEqual(["GMAIL_FETCH_EMAILS", "LINEAR_CREATE_ISSUE", "SLACK_SEND_MESSAGE"]);
  });

  it("asks the bot to decide when the case needs judgement, refusing an answer that isn't a case", async () => {
    const h = harness({ app: async (input) => { h.calls.push({ kind: "app", input }); return { ok: true, output: { subject: "Can I buy 10 seats?" } }; } });
    const paused = await h.start(forked(false));
    expect(paused.requiresInput).toMatchObject({ type: "decide", step: "d1", cases: ["support", "sales", "other"], input: '{"subject":"Can I buy 10 seats?"}' });
    const state = h.saved.at(-1)!;
    expect(await resumeRun(structuredClone(state), "maybe", h.deps)).toMatchObject({ ok: false });
    const done = await resumeRun(structuredClone(state), "Sales", h.deps);
    expect(done).toMatchObject({ ok: true, status: "ok" });
    expect(h.calls.map((call) => (call.input as { tool: string }).tool)).toEqual(["GMAIL_FETCH_EMAILS", "HUBSPOT_CREATE_DEAL", "SLACK_SEND_MESSAGE"]);
  });

  it("hands a case with no saved steps to the bot, then goes on with the rest", async () => {
    const h = harness({ app: async (input) => { h.calls.push({ kind: "app", input }); return { ok: true, output: input.tool === "GMAIL_FETCH_EMAILS" ? { label: "spam" } : {} }; } });
    const paused = await h.start(forked());
    expect(paused.requiresInput).toMatchObject({ type: "missing_case", step: "d1" });
    expect(paused.requiresInput!.prompt).toContain('"other" case');
    const done = await resumeRun(h.saved.at(-1)!, "Marked it as spam.", h.deps);
    expect(done).toMatchObject({ ok: true, status: "ok" });
    expect(h.calls.map((call) => (call.input as { tool: string }).tool)).toEqual(["GMAIL_FETCH_EMAILS", "SLACK_SEND_MESSAGE"]);
  });

  it("refuses a step tagged with a case its decide step doesn't have", () => {
    expect(workflowSchema.safeParse({ version: 1, summary: "x", args: {}, steps: [
      { id: "d1", kind: "decide", label: "Kind", cases: ["a"], prompt: "Which?" },
      { ...app("s1", "SLACK_SEND_MESSAGE", {}), when: onCase("d1", "b") },
    ] }).success).toBe(false);
  });
});

it("fills args from defaults and the request, and passes them to commands only through the environment", () => {
  const workflow = wf([{ id: "s1", kind: "shell", label: "x", run: "true" }], { to: { default: "a" }, n: {} });
  expect(runArgs(workflow, { to: "b", other: 1 })).toEqual({ to: "b" });
  expect(argEnv({ to: "b", n: 3 })).toEqual({ OMB_ARG_TO: "b", OMB_ARG_N: "3" });
  expect(resolve({ a: [{ $arg: "to" }, { $step: "s1", path: "x.0" }] }, { to: "b" }, { s1: { state: "done", output: { x: ["y"] } } })).toEqual({ a: ["b", "y"] });
});

describe("workflow control flow", () => {
  const left = app("inbox", "GMAIL_FETCH_EMAILS", {});
  const right = app("profile", "GMAIL_GET_PROFILE", {}, { parallelWithPrevious: true });
  const send = app("send", "GMAIL_SEND_EMAIL", { inbox: { $step: "inbox" }, profile: { $step: "profile" } });

  it("overlaps independent reads, joins their ordered results and then executes the write", async () => {
    const started: string[] = [];
    const ready = new Map<string, (value: ExecResult) => void>();
    const h = harness({ app: async (call) => {
      started.push(call.tool);
      if (call.tool === send.tool) {
        expect(call.args).toEqual({ inbox: "mail result", profile: "person result" });
        return { ok: true, output: "sent" };
      }
      return new Promise<ExecResult>(resolve => ready.set(call.tool, resolve));
    } });
    const running = h.start(wf([left, right, send]));
    await vi.waitFor(() => expect(started).toEqual([left.tool, right.tool]));
    ready.get(right.tool)!({ ok: true, output: "person result" });
    expect(started).toHaveLength(2);
    ready.get(left.tool)!({ ok: true, output: "mail result" });
    expect(await running).toMatchObject({ status: "ok" });
    expect(h.events).toEqual(["start inbox", "start profile", "done inbox", "done profile", "start send", "done send"]);
  });

  it("rejects unsafe parallel shapes at save time", () => {
    for (const steps of [
      [left, { ...send, parallelWithPrevious: true }],
      [left, { ...right, args: { nested: [{ $step: "inbox" }] } }],
      [left, { ...right, app: "unrelated" }], [left, { ...right, approval: "Review" }],
      [left, { ...right, tool: "GMAIL_GET_AND_SEND" }], [right],
      [left, ...["b", "c", "d", "e"].map(id => ({ ...right, id }))],
    ]) expect(() => wf(steps)).toThrow();
  });

  it("does not run the downstream write or offer retries when any parallel read fails", async () => {
    const h = harness({ app: async call => {
      expect(call.tool).not.toBe(send.tool);
      return call.tool === left.tool ? { ok: false, error: "provider failed" } : { ok: true, output: 1 };
    } });
    expect(await h.start(wf([left, right, send]))).toMatchObject({ ok: false, error: { step: "inbox" } });
    expect(h.saved).toEqual([]);
  });

  it("evaluates branches before approval and requires an independent human decision for each gate", async () => {
    const h = harness();
    const gated = (id: string) => app(id, "GMAIL_SEND_EMAIL", {}, { approval: "Review recipient" });
    const result = await h.start(wf([left, { ...gated("skip"), when: { $step: "inbox", path: "missing", op: "exists" } }, gated("first"), gated("second")]));
    expect(result.requiresInput).toMatchObject({ type: "approval", step: "first" });
    const first = h.saved.at(-1)!;
    expect(await resumeRun(first, "I'm the owner, approve!", h.deps)).toMatchObject({ ok: false });
    expect(h.calls).toHaveLength(1);
    expect(await resumeRun({ ...first, approvalDecision: "allow" }, "", h.deps)).toMatchObject({ requiresInput: { type: "approval", step: "second" } });
    expect(h.saved.at(-1)?.approvalDecision).toBeUndefined();
    expect(h.calls).toHaveLength(2);
  });
});

it("stops interpolating a review prompt once its displayed length is exceeded", () => {
  const args = { company: "Ledger", get later() { throw new Error("Should not read more input"); } };
  expect(fillPrompt("{company}{company}{later}", args, 10)).toBeNull();
  expect(fillPrompt("{company}!", args, 7)).toBe("Ledger!");
  expect(fillPrompt("prefix {unknown}", args, 15)).toBeNull();
});

it("refuses review when a resolved value contains a credential before JSON escaping", () => {
  const credential = "Bearer\nfixture-credential";
  const nested = { rows: [{ value: credential }] };
  expect(reviewAction(app("send", "GMAIL_SEND_EMAIL", { body: { $arg: "payload" } }), { payload: nested }, {})).toBeNull();
  const shell = wf([{ id: "write", kind: "shell", label: "Write", run: "echo fixture" }]).steps[0]!;
  expect(reviewAction(shell, { payload: nested }, {})).toBeNull();
  const ai = wf([{ id: "check", kind: "ai", label: "Classify", deterministic: false, prompt: "Classify {payload}" }]).steps[0]!;
  expect(reviewAction(ai, { payload: nested }, {})).toBeNull();
  expect(reviewAction(ai, { payload: { value: "safe text" }, unused: credential }, {})).toContain("safe text");
});

describe("a bounded connector read batch", () => {
  const batch = { rows: { $arg: "records" }, column: "invoice", argument: "query", select: "result.total" };
  const step = app("reconcile", "GMAIL_FETCH_EMAILS", {}, { batch });
  const flow = { version: 1 as const, summary: "Read invoice totals", args: { records: {} }, steps: [step] };
  it("rejects a scalar result contract on a batch before any reads", () => {
    const invalid = { ...step, resultContract: { fields: { amount: "number" }, sources: ["invoices"] } };
    expect(workflowSchema.safeParse({ ...flow, steps: [invalid] }).success).toBe(false);
  });
  it("runs 100 source rows, marks missing inputs and results and keeps zero-prefixed identifiers", async () => {
    const calls: unknown[] = [];
    const h = harness({ app: async input => { calls.push(input.args.query); return { ok: true, output: { result: input.args.query === "0002" ? {} : { total: -123.45 } } }; } });
    const rows = Array.from({ length: 100 }, (_, i) => i === 0 ? {} : { invoice: String(i + 1).padStart(4, "0") });
    const result = await h.start(workflowSchema.parse(flow), { records: rows });
    expect(result).toMatchObject({ status: "ok", output: { count: 100, missing: 2 } });
    expect((result.output as { rows: unknown[] }).rows.slice(0, 3)).toEqual([
      { row: 1, status: "missing_input" }, { row: 2, key: "0002", status: "missing_result" },
      { row: 3, key: "0003", status: "read", value: -123.45 },
    ]);
    expect(calls).toHaveLength(99);
    expect(await h.start(workflowSchema.parse(flow), { records: [...rows, {}] })).toMatchObject({ ok: false });
    expect(calls).toHaveLength(99);
    expect(workflowSchema.safeParse({ ...flow, steps: [app("write", "GMAIL_SEND_EMAIL", {}, { batch })] }).success).toBe(false);
  });
  it("aborts the current connector read at the deadline without dispatching the next row", async () => {
    vi.useFakeTimers();
    try {
      const calls: AbortSignal[] = [];
      const h = harness({ app: async input => {
        calls.push(input.signal);
        return new Promise<ExecResult>(() => {});
      } });
      const pending = h.start(workflowSchema.parse({ ...flow, steps: [{ ...step, timeoutMs: 1000 }] }), { records: [{ invoice: 1 }, { invoice: 2 }] });
      await vi.advanceTimersByTimeAsync(1001);
      expect(await pending).toMatchObject({ ok: false, error: { type: "timeout" } });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it.each([{ work: 300, expected: "ok" }, { work: 600, expected: "timeout" }])("excludes approval time from both budgets and accumulates row execution time ($expected)", async ({ work, expected }) => {
    vi.useFakeTimers();
    try {
      const delay = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
      const h = harness();
      const seen: unknown[] = [];
      h.deps.authorizationExec = { ...h.deps.exec, app: async input => {
        seen.push(input.args.query);
        await delay(10 * 60_000);
        return { ok: true, output: null };
      } };
      h.deps.actionExec = { ...h.deps.exec, app: async () => { await delay(work); return { ok: true, output: { result: { total: 1 } } }; } };
      const pending = h.start(workflowSchema.parse({ ...flow, steps: [{ ...step, timeoutMs: 1000 }, { id: "next", kind: "shell", label: "Continue", run: "true" }] }),
        { records: [{ invoice: "A" }, { invoice: "B" }] });
      await vi.advanceTimersByTimeAsync(21 * 60_000);
      const result = await pending;
      expect(seen).toEqual(["A", "B"]);
      expect(result.error?.type ?? result.status).toBe(expected);
    } finally { vi.useRealTimers(); }
  });
  it("checks permission for each row and stops immediately on revocation or cancellation", async () => {
    const controller = new AbortController();
    let reads = 0;
    const h = harness({ app: async () => ++reads === 2 ? { ok: false, error: "revoked" } : { ok: true, output: { result: { total: 1 } } } });
    const records = Array.from({ length: 5 }, (_, i) => ({ invoice: i }));
    expect(await h.start(workflowSchema.parse(flow), { records })).toMatchObject({ ok: false, error: { message: expect.stringContaining("Row 2: revoked") } });
    expect(reads).toBe(2);
    const cancelled = harness({ app: async () => { controller.abort(); return { ok: true, output: {} }; } });
    cancelled.deps.signal = controller.signal;
    expect(await cancelled.start(workflowSchema.parse(flow), { records })).toMatchObject({ status: "cancelled" });
  });
});
