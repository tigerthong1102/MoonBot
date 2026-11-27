import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workflowSchema, type Workflow } from "../../shared/skill-burger/format.ts";
import { runText } from "../drivers/agents-workflow-tool.ts";
import { readReview } from "./delegate-step.ts";
import { guardedExecutors } from "./guarded-executors.ts";
import { createRunStates } from "./run-state.ts";
import { resumeRun, startRun, type RunDeps, type RunEnvelope, type RunState, type StepExecutors } from "./runner.ts";

const wf = (steps: unknown[], args: Workflow["args"] = {}): Workflow => {
  const checked = workflowSchema.safeParse({ version: 1, summary: "QA-test a site", args, steps });
  if (!checked.success) throw new Error(checked.error.message);
  return checked.data;
};

const qa = (rounds = 1) => wf([
  {
    id: "s1", kind: "delegate", label: "Ask Kiwi, Rio and Miso",
    tasks: [
      { bot: { id: "kiwi", name: "Kiwi", role: "Accessibility tester" }, message: ["QA-test ", { $arg: "site" }, " for accessibility."], doneWhen: "3 findings, each naming the URL" },
      { bot: { id: "rio", name: "Rio", role: "Performance tester" }, message: ["QA-test ", { $arg: "site" }, " for speed."], doneWhen: "3 findings, each naming the URL" },
      { bot: { id: "miso", name: "Miso", role: "Content tester" }, message: ["QA-test ", { $arg: "site" }, " for content."], doneWhen: "3 findings, each naming the URL" },
    ],
    review: { rounds, example: "Rio: re-check your top finding" },
  },
  { id: "s2", kind: "ai", deterministic: false, label: "Review what came back and report", prompt: "Give a short verdict.", input: { $step: "s1", path: "text" } },
], { site: { default: "https://mausbot.com", label: "site" } });

/** A coordinator: hands out request ids, and settles each when the test says so. */
function team(roster: Array<{ id: string; name: string; title?: string }> = [{ id: "kiwi", name: "Kiwi", title: "Accessibility tester" }, { id: "rio", name: "Rio", title: "Performance tester" }, { id: "miso", name: "Miso", title: "Content tester" }]) {
  const sent: Array<{ botIds: string[]; message: string; doneWhen?: string; rework?: boolean }> = [];
  const status = new Map<string, { status: string; result: string; bot: string }>();
  let n = 0;
  const exec: StepExecutors = {
    shell: async () => ({ ok: true, output: "" }), app: async () => ({ ok: true, output: {} }), browser: async () => ({ ok: true, output: "" }), file: async () => ({ ok: true, output: "" }),
    teammates: async () => roster,
    delegate: async (input) => {
      sent.push({ botIds: input.botIds, message: input.message, ...(input.doneWhen ? { doneWhen: input.doneWhen } : {}), ...(input.rework ? { rework: true } : {}) });
      return { ok: true, receipts: input.botIds.map((botId) => { const requestId = `req-${++n}`; status.set(requestId, { status: "running", result: "", bot: botId }); return { botId, name: roster.find((bot) => bot.id === botId)!.name, requestId }; }) };
    },
    assignment: async (id) => status.get(id) ?? null,
  };
  const reply = (bot: string, result: string, finishedAt?: number) => { for (const one of status.values()) if (one.bot === bot && one.status === "running") Object.assign(one, { status: "completed", result, finishedAt }); };
  const fail = (bot: string, outcome: string) => { for (const one of status.values()) if (one.bot === bot && one.status === "running") Object.assign(one, { status: outcome, result: "failed" }); };
  return { exec, sent, reply, fail };
}

function harness(exec: StepExecutors) {
  const saved: RunState[] = [];
  const events: string[] = [];
  const deps: RunDeps = { exec, save: (state) => { saved.push(structuredClone(state)); }, events: { started: (_r, _n, step) => events.push(`start ${step.id}`), ended: (_r, _n, step, result) => events.push(`${result.state} ${step.id}`) } };
  const last = () => saved[saved.length - 1]!;
  return { deps, saved, events, last, resume: (response: string) => resumeRun(last(), response, deps) };
}

describe("a saved delegation", () => {
  it("matches and dispatches a teammate whose name is a prototype property", async () => {
    const t = team([{ id: "constructor-id", name: "constructor" }]);
    const h = harness(t.exec);
    const workflow = wf([{ id: "s1", kind: "delegate", label: "Ask constructor", tasks: [{ bot: { id: "old-id", name: "constructor" }, message: "Inspect this fixture" }] }]);
    await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow }, h.deps);
    expect(t.sent[0]?.botIds).toEqual(["constructor-id"]);
  });
  it("delegates the fresh output of the preceding step", async () => {
    const t = team();
    t.exec.shell = async () => ({ ok: true, output: "Fresh task from the current email" });
    const workflow = wf([{ id: "s1", kind: "shell", label: "Read task", run: "cat task.txt" }, { id: "s2", kind: "delegate", label: "Ask Kiwi", tasks: [{ bot: { id: "kiwi", name: "Kiwi" }, message: [{ $step: "s1" }] }] }]);
    await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow }, harness(t.exec).deps);
    expect(t.sent[0]?.message).toBe("Fresh task from the current email");
  });
  it("uses changed input in both delegation criteria and review", async () => {
    const t = team();
    const h = harness(t.exec);
    const workflow = wf([{ id: "s1", kind: "delegate", label: "Ask Kiwi", tasks: [{ bot: { id: "kiwi", name: "Kiwi" }, message: ["Inspect ", { $arg: "site" }], doneWhen: ["Report findings for ", { $arg: "site" }] }], review: { rounds: 1 } }], { site: { default: "https://old.example" } });
    await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow, args: { site: "https://new.example" } }, h.deps);
    expect(t.sent[0]).toMatchObject({ message: "Inspect https://new.example", doneWhen: "Report findings for https://new.example" });
    t.reply("kiwi", "done");
    const review = await h.resume("back");
    expect(review.requiresInput?.prompt).toContain("Report findings for https://new.example");
    expect(review.requiresInput?.prompt).not.toContain("old.example");
  });
  it("does not send any handoff when expanded criteria exceed the limit", async () => {
    const t = team();
    const workflow = wf([{ id: "s1", kind: "delegate", label: "Ask Kiwi", tasks: [{ bot: { id: "kiwi", name: "Kiwi" }, message: "Inspect", doneWhen: [{ $arg: "site" }] }] }], { site: {} });
    const result = await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow, args: { site: "x".repeat(1_001) } }, harness(t.exec).deps);
    expect(result.ok).toBe(false);
    expect(t.sent).toHaveLength(0);
  });
  it("sends a long correction within the production authorization limit", async () => {
    const t = team();
    const exec = guardedExecutors(t.exec, { allowed: () => true, approve: async () => true });
    const h = harness(exec);
    const original = "a".repeat(3_000);
    const correction = "b".repeat(1_100);
    const workflow = wf([{ id: "s1", kind: "delegate", label: "Ask Kiwi", tasks: [{ bot: { id: "kiwi", name: "Kiwi" }, message: original }], review: { rounds: 1 } }]);
    await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow }, h.deps);
    t.reply("kiwi", "draft");
    expect(await h.resume("back")).toMatchObject({ requiresInput: { type: "review" } });
    expect(await h.resume(JSON.stringify({ redo: { Kiwi: correction } }))).toMatchObject({ requiresInput: { type: "teammates" } });
    expect(t.sent[1]).toMatchObject({ message: correction, rework: true });
  });
  it("places the current single-use token in the teammate handoff prompt", async () => {
    const t = team();
    const h = harness(t.exec);
    const states = createRunStates(mkdtempSync(join(tmpdir(), "workflow-token-")));
    h.deps.save = (state) => states.save(state);
    const result = await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: qa() }, h.deps);
    expect(result.requiresInput?.resumeToken).not.toBe(result.run);
    expect(result.requiresInput?.prompt).toContain(JSON.stringify(result.requiresInput!.resumeToken));
  });
  it.each(["failed", "cancelled"])("stops before the next step when a teammate is %s", async (outcome) => {
    const t = team();
    const h = harness(t.exec);
    const source = qa();
    const first = source.steps[0]!;
    if (first.kind !== "delegate") throw new Error("expected a delegation");
    const { review: _review, ...withoutReview } = first;
    await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: { ...source, steps: [withoutReview, ...source.steps.slice(1)] } }, h.deps);
    t.reply("kiwi", "done");
    t.fail("rio", outcome);
    t.reply("miso", "done");
    expect(await h.resume("back")).toMatchObject({ ok: false, error: { type: "step_failed", step: "s1", message: expect.stringContaining("Rio") } });
    expect(h.events).toContain("failed s1");
    expect(h.events).not.toContain("start s2");
  });
  it("sends every part at once with the new input, pauses, then reviews and goes on", async () => {
    const t = team();
    const h = harness(t.exec);
    const first = await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: qa(), args: { site: "https://example.org" } }, h.deps);
    expect(first).toMatchObject({ status: "needs_input", requiresInput: { type: "teammates", step: "s1" } });
    expect(first.defaults).toBeUndefined();
    expect(t.sent.map((call) => [call.botIds, call.message])).toEqual([
      [["kiwi"], "QA-test https://example.org for accessibility."], [["rio"], "QA-test https://example.org for speed."], [["miso"], "QA-test https://example.org for content."],
    ]);
    expect(t.sent.every((call) => call.doneWhen === "3 findings, each naming the URL")).toBe(true);
    expect(runText(first as never)).toContain("End your turn");

    // Resumed before everyone replied: it waits again and sends nothing new.
    t.reply("kiwi", "1. contrast https://example.org/ 2. … 3. …");
    const early = await h.resume("back");
    expect(early).toMatchObject({ status: "needs_input", requiresInput: { type: "teammates" } });
    expect(early.requiresInput!.prompt).toContain("Still waiting on Rio, Miso");
    expect(t.sent).toHaveLength(3);

    t.reply("rio", "1. LCP 3.4 s on https://example.org/ …");
    t.reply("miso", "Looks fine.");
    const review = await h.resume("back");
    expect(review).toMatchObject({ status: "needs_input", requiresInput: { type: "review" } });
    expect(review.requiresInput!.input).toContain("## Miso");
    expect(review.requiresInput!.prompt).toContain("Kiwi: 3 findings, each naming the URL");

    // Miso's reply falls short: only Miso goes back, as rework, with the fix and the original ask.
    const rework = await h.resume('{"redo": {"Miso": "Give 3 findings, each with the URL you checked."}}');
    expect(rework).toMatchObject({ status: "needs_input", requiresInput: { type: "teammates" } });
    expect(t.sent.slice(3)).toEqual([{ botIds: ["miso"], message: "Give 3 findings, each with the URL you checked.\n\nThe work, as first asked:\nQA-test https://example.org for content.", doneWhen: "3 findings, each naming the URL", rework: true }]);

    t.reply("miso", "1. broken link https://example.org/x 2. … 3. …");
    const ai = await h.resume("back");
    // The one extra round is used: no second review, the step is done and the bot's review step is next.
    expect(ai).toMatchObject({ status: "needs_input", requiresInput: { type: "ai_step", step: "s2" } });
    expect(ai.requiresInput!.input).toContain("broken link https://example.org/x");
    expect(ai.requiresInput!.input).toContain("LCP 3.4 s");
    const done = await h.resume("Verdict: ship it.");
    expect(done).toMatchObject({ ok: true, status: "ok", output: "Verdict: ship it." });
    expect(h.events.filter((event) => event.endsWith("s1"))).toEqual(["start s1", "done s1"]);
  });

  it("says which saved inputs it reused when the request gave none", async () => {
    const t = team();
    const envelope = await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: qa() }, harness(t.exec).deps);
    expect(envelope.defaults).toEqual([{ name: "site", value: "https://mausbot.com" }]);
    expect(runText(envelope as never)).toContain('the run used the saved value: site = "https://mausbot.com"');
  });

  it("finishes when the review says every reply is done, and stops sending back after the allowed rounds", async () => {
    const t = team();
    const h = harness(t.exec);
    await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: qa(1) }, h.deps);
    for (const bot of ["kiwi", "rio", "miso"]) t.reply(bot, `${bot} done`);
    await h.resume("back");
    expect(await h.resume('{"redo": {}}')).toMatchObject({ requiresInput: { type: "ai_step", step: "s2" } });
    expect(t.sent).toHaveLength(3);
    expect(readReview("done", { round: 1, who: {}, requests: [], replies: {} })).toEqual({});
    expect(readReview("not json", { round: 1, who: {}, requests: [], replies: {} })).toBeNull();
    const review = { round: 1, who: {}, requests: [], replies: { Rio: { name: "Rio", text: "draft", ok: true, round: 1 } } };
    expect(readReview('{"redo":{"unknown":"fix"}}', review)).toBeNull();
    expect(readReview('{"redo":{"Rio":" "}}', review)).toBeNull();
    expect(readReview('{"redo":{"Rio":"fix"}}', review)).toEqual({ Rio: "fix" });
    const reassigned = { ...review, replies: { Kiwi: { name: "Rio", text: "first", ok: true, round: 1 }, Rio: { name: "Rio", text: "second", ok: true, round: 1 } } };
    expect(readReview('{"redo":{"Rio":"fix"}}', reassigned)).toEqual({ Rio: "fix" });
    expect(readReview('{"redo":{"Rio":"fix"}}', { ...review, replies: { Kiwi: reassigned.replies.Kiwi, Miso: reassigned.replies.Rio } })).toBeNull();
  });

  it("rejects duplicate teammate names in saved delegated tasks", () => {
    const parsed = workflowSchema.safeParse({ version: 1, summary: "x", args: {}, steps: [{ id: "s1", kind: "delegate", label: "Delegate", tasks: [{ bot: { name: "Rio" }, message: "first" }, { bot: { name: "@rio" }, message: "second" }] }] });
    expect(parsed.success).toBe(false);
  });

  it("reports an unavailable roster instead of claiming that teammates disappeared", async () => {
    const t = team();
    t.exec.teammates = async () => { throw new Error("roster unavailable"); };
    const h = harness(t.exec);
    const result = await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: qa(1) }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining("roster unavailable"), resumeToken: expect.any(String) } });
    expect(t.sent).toHaveLength(0);
  });

  it("checks delegated results before advancing to the next step", async () => {
    const t = team();
    const h = harness(t.exec);
    const original = qa(1);
    const workflow = workflowSchema.parse({ ...original, steps: [{ ...original.steps[0], check: { says: "Kiwi passed", rule: { path: "replies.Kiwi", op: "eq", value: "passed" } } }, original.steps[1]] });
    await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow }, h.deps);
    for (const bot of ["kiwi", "rio", "miso"]) t.reply(bot, `${bot} result`);
    expect(await h.resume("back")).toMatchObject({ requiresInput: { type: "review" } });
    expect(await h.resume('{"redo":{}}')).toMatchObject({ ok: false, error: { type: "step_failed", message: expect.stringContaining("Kiwi passed") } });
  });

  it("gives a gone teammate's part to the one with its role, or asks the bot who does it", async () => {
    // Kiwi is gone; Ada has Kiwi's role. Rio is gone and nobody has its role.
    const t = team([{ id: "ada", name: "Ada", title: "Accessibility tester" }, { id: "miso", name: "Miso", title: "Content tester" }, { id: "zed", name: "Zed", title: "SRE" }]);
    const h = harness(t.exec);
    const asked = await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: qa() }, h.deps);
    expect(asked).toMatchObject({ status: "needs_input", requiresInput: { type: "missing_bot" } });
    expect(asked.requiresInput!.prompt).toContain("Rio (Performance tester) isn't one of your teammates any more");
    expect(t.sent).toHaveLength(0);
    expect(await h.resume("Bob")).toMatchObject({ status: "needs_input", requiresInput: { type: "missing_bot", prompt: expect.stringContaining("Bob isn't one of your teammates") } });
    const sent = await h.resume("Zed");
    expect(sent).toMatchObject({ requiresInput: { type: "teammates" } });
    expect(t.sent.map((call) => [call.botIds, call.message])).toEqual([
      [["ada"], "QA-test https://mausbot.com for accessibility."], [["zed"], "QA-test https://mausbot.com for speed."], [["miso"], "QA-test https://mausbot.com for content."],
    ]);
  });

  it("can leave a gone teammate's part out", async () => {
    const t = team([{ id: "kiwi", name: "Kiwi" }, { id: "miso", name: "Miso" }]);
    const h = harness(t.exec);
    await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: qa() }, h.deps);
    await h.resume("skip");
    expect(t.sent.map((call) => call.botIds[0])).toEqual(["kiwi", "miso"]);
  });

  it("continues when every unavailable teammate is explicitly skipped", async () => {
    const t = team([]);
    const h = harness(t.exec);
    const original = qa();
    const delegate = original.steps[0]!;
    if (delegate.kind !== "delegate") throw new Error("expected a delegation");
    const workflow = { ...original, steps: [{ ...delegate, tasks: [delegate.tasks[0]!] }, ...original.steps.slice(1)] };
    await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow }, h.deps);
    expect(await h.resume("skip")).toMatchObject({ status: "needs_input", requiresInput: { type: "ai_step", step: "s2" } });
    expect(t.sent).toHaveLength(0);
    expect(h.events).toContain("skipped s1");
  });

  it("fails the step, names why, and can go on from it once fixed", async () => {
    const t = team();
    let refuse = true;
    const exec: StepExecutors = { ...t.exec, delegate: async (input) => (refuse ? { ok: false, error: "Rio is at its plan's hand-off limit", definitive: true } : t.exec.delegate!(input)) };
    const h = harness(exec);
    const failed: RunEnvelope = await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: qa() }, h.deps);
    expect(failed).toMatchObject({ ok: false, error: { step: "s1", message: '"Ask Kiwi, Rio and Miso" failed: Rio is at its plan\'s hand-off limit', resumeToken: failed.run } });
    expect(runText(failed as never)).toContain(`call run_workflow with resume "${failed.run}" to go on from that step`);
    refuse = false;
    expect(await h.resume("fixed")).toMatchObject({ requiresInput: { type: "teammates" } });
  });

  it("retries only a refused review handoff and keeps earlier replies", async () => {
    const t = team();
    let refuse = true;
    const exec: StepExecutors = { ...t.exec, delegate: async (input) => input.rework && refuse ? { ok: false, error: "refused", definitive: true } : t.exec.delegate!(input) };
    const h = harness(exec);
    await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: qa(1) }, h.deps);
    for (const bot of ["kiwi", "rio", "miso"]) t.reply(bot, `${bot} result`);
    await h.resume("back");
    const failed = await h.resume('{"redo":{"Rio":"check again"}}');
    expect(failed.error?.resumeToken).toBeDefined();
    expect(t.sent).toHaveLength(3);
    refuse = false;
    expect(await h.resume("retry")).toMatchObject({ requiresInput: { type: "teammates" } });
    expect(t.sent).toHaveLength(4);
    expect(t.sent[3]!.botIds).toEqual(["rio"]);
    expect(h.saved.at(-1)?.delegation?.replies).toMatchObject({ Kiwi: { text: "kiwi result" }, Miso: { text: "miso result" } });
  });

  it("does not offer a retry when earlier hand-offs were accepted before a later refusal", async () => {
    const t = team();
    let count = 0;
    const exec: StepExecutors = { ...t.exec, delegate: async (input) => {
      count += 1;
      return count === 1 ? t.exec.delegate!(input) : { ok: false, error: "connection lost" };
    } };
    const h = harness(exec);
    const failed = await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: qa() }, h.deps);
    expect(t.sent).toHaveLength(1);
    expect(failed.error?.message).toContain("may already have received work");
    expect(failed.error?.resumeToken).toBeUndefined();
    expect(h.saved).toHaveLength(0);
  });

  it("does not retry after a hand-off throws with an unknown outcome", async () => {
    const t = team();
    let count = 0;
    const exec: StepExecutors = { ...t.exec, delegate: async (input) => {
      count += 1;
      if (count === 1) return t.exec.delegate!(input);
      throw new Error("connection lost");
    } };
    const h = harness(exec);
    const failed = await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow: qa() }, h.deps);
    expect(t.sent).toHaveLength(1);
    expect(failed.error?.message).toContain("may already have received work");
    expect(failed.error?.resumeToken).toBeUndefined();
    expect(h.saved).toHaveLength(0);
  });
});

describe("a step's check", () => {
  const shell = (check: unknown) => wf([
    { id: "s1", kind: "shell", label: "Count rows", run: "wc -l < done.csv", check },
    { id: "s2", kind: "shell", label: "Archive", run: "cp done.csv archive/" },
  ]);
  const runWith = (output: string, check: unknown) => {
    const h = harness({ shell: async () => ({ ok: true, output }), app: async () => ({ ok: true, output: {} }), browser: async () => ({ ok: true, output: "" }), file: async () => ({ ok: true, output: "" }) });
    return { h, run: startRun({ name: "csv", botId: "b", threadId: "t", sha256: "x", workflow: shell(check) }, h.deps) };
  };

  it("fails a step whose rule doesn't hold, and passes one whose rule does", async () => {
    expect(await runWith("0", { says: "there is at least one row", rule: { op: "gt", value: 0 } }).run).toMatchObject({ ok: false, error: { step: "s1", message: expect.stringContaining("its check didn't hold: there is at least one row") } });
    expect(await runWith("12", { says: "there is at least one row", rule: { op: "gt", value: 0 } }).run).toMatchObject({ ok: true, status: "ok" });
  });

  it("asks the bot when only words say what done means", async () => {
    const { h, run } = runWith("12", { says: "the CSV has a header row" });
    expect(await run).toMatchObject({ status: "needs_input", requiresInput: { type: "check", step: "s1", input: "12" } });
    const savedBefore = h.saved.length;
    const failed = await h.resume("fail: no header");
    expect(failed).toMatchObject({ ok: false, error: { message: expect.stringContaining('"Count rows" didn\'t pass its check: no header') } });
    expect(failed.error?.resumeToken).toBeUndefined();
    expect(h.saved).toHaveLength(savedBefore);
    const passing = runWith("12", { says: "the CSV has a header row" });
    await passing.run;
    expect(await passing.h.resume("pass")).toMatchObject({ ok: true, status: "ok" });
  });
});

describe("the run_workflow tool", () => {
  it("distinguishes nested workflow inputs from an unnamed resume envelope", async () => {
    const { callWorkflowTool } = await import("../drivers/agents-workflow-tool.ts");
    const calls: Array<{ path: string; body: unknown }> = [];
    const context = { client: { apiResponse: async (path: string, init: { body: string }) => { calls.push({ path, body: JSON.parse(init.body) }); return { ok: true, status: 200, body: { protocolVersion: 1, ok: true, status: "ok", run: "r", steps: [] } }; } } };
    await callWorkflowTool("run_workflow", { args: { resume: "run-7", response: "Wrote wait.md" } }, context as never);
    await callWorkflowTool("run_workflow", { name: "qa", resume: "run-7", response: { redo: { Rio: "add the URL" } } }, context as never);
    await callWorkflowTool("run_workflow", { name: "qa", args: { resume: "report.pdf" } }, context as never);
    expect(calls).toEqual([
      { path: "/api/internal/skill-burgers/resume", body: { run: "run-7", response: "Wrote wait.md" } },
      { path: "/api/internal/skill-burgers/resume", body: { run: "run-7", response: '{"redo":{"Rio":"add the URL"}}' } },
      { path: "/api/internal/skill-burgers/run", body: { name: "qa", args: { resume: "report.pdf" } } },
    ]);
  });

  it("includes the required workflow name in its undo instruction", async () => {
    const { callWorkflowTool } = await import("../drivers/agents-workflow-tool.ts");
    const context = { client: { apiResponse: async () => ({ ok: true, body: { undo: "token-1" } }) } };
    const result = await callWorkflowTool("workflow_edit", { name: "sales", action: "set_when" }, context as never);
    expect(result.text).toContain('name "sales", action "undo"');
    expect(result.text).toContain('undo "token-1"');
  });
});

describe("worker result contracts", () => {
  const contract = { fields: { amount: "number" }, sources: ["invoice.pdf#page=2"] };
  const workflow = wf([{ id: "s1", kind: "delegate", label: "Read invoice", tasks: [
    { bot: { id: "kiwi", name: "Kiwi" }, message: "Read the total.", resultContract: contract },
  ], timeoutMs: 1000 }]);

  it("rejects source contracts that cannot fit the approved handoff when saving", () => {
    const sources = Array.from({ length: 24 }, (_, index) => `https://example.test/${index}/${"x".repeat(190)}`);
    expect(() => wf([{ id: "s1", kind: "delegate", label: "Collect", tasks: [
      { bot: { id: "kiwi", name: "Kiwi" }, message: "Collect totals", resultContract: { ...contract, sources } },
    ] }])).toThrow("The handoff exceeds 4,000 characters");
  });

  it("checks expanded contract messages before sending any part of the round", async () => {
    const t = team();
    const workflow = wf([{ id: "s1", kind: "delegate", label: "Collect", tasks: [
      { bot: { id: "kiwi", name: "Kiwi" }, message: "Start here" },
      { bot: { id: "rio", name: "Rio" }, message: [{ $arg: "subject" }], resultContract: contract },
    ] }], { subject: {} });
    const run = await startRun({ name: "qa", botId: "lead", threadId: "t1", sha256: "x", workflow,
      args: { subject: '"'.repeat(2_000) } }, harness(t.exec).deps);
    expect(run.ok).toBe(false);
    expect(t.sent).toHaveLength(0);
  });

  it.each([
    [JSON.stringify({ amount: 12, sources: ["invoice.pdf#page=2"] }), true],
    [JSON.stringify({ amount: "12", sources: ["invoice.pdf#page=2"] }), false],
    [JSON.stringify({ amount: 12, sources: ["another invoice"] }), false],
    ["not JSON", false],
  ])("accepts only a typed result with declared evidence", async (text, ok) => {
    const t = team(), h = harness(t.exec);
    await startRun({ name: "report", botId: "lead", threadId: "t1", sha256: "x", workflow }, h.deps);
    expect(t.sent[0]?.message).toContain("invoice.pdf#page=2");
    t.reply("kiwi", text);
    const result = await h.resume("returned");
    expect(result.ok).toBe(ok);
    if (ok) expect(result.output).toMatchObject({ replies: { Kiwi: JSON.parse(text) } });
  });

  it.each([
    { finishedAt: 2100, ok: true },
    { finishedAt: 2200, ok: true },
    { finishedAt: 2201, ok: false },
  ])("applies the saved deadline to completion at $finishedAt even when collection happens later", async ({ finishedAt, ok }) => {
    let clock = 1200;
    const t = team(), h = harness(t.exec);
    h.deps.now = () => clock;
    await startRun({ name: "report", botId: "lead", threadId: "t1", sha256: "x", workflow }, h.deps);
    t.reply("kiwi", JSON.stringify({ amount: 12, sources: contract.sources }), finishedAt);
    clock = 3300;
    expect((await h.resume("collect after the deadline")).ok).toBe(ok);
  });

  it("expires an unfinished assignment when collection reaches the deadline", async () => {
    let clock = 1200;
    const t = team(), h = harness(t.exec);
    h.deps.now = () => clock;
    await startRun({ name: "report", botId: "lead", threadId: "t1", sha256: "x", workflow }, h.deps);
    clock = 2200;
    expect((await h.resume("collect")).ok).toBe(false);
  });
});
