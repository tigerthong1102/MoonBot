import { describe, expect, it } from "vitest";

import { applyDecisions, parseDecisions } from "../../shared/skill-burger/decisions.ts";
import { caseOf, onCase, renderWorkflowSkillMd, workflowSchema, type Workflow } from "../../shared/skill-burger/format.ts";
import { applyEdit, createEditUndo, editSchema } from "./edit.ts";

const base: Workflow = workflowSchema.parse({
  version: 1, summary: "Sort new email", args: {},
  steps: [
    { id: "s1", kind: "app", app: "gmail", tool: "GMAIL_FETCH_EMAILS", label: "Fetch emails", args: {} },
    { id: "s2", kind: "app", app: "slack", tool: "SLACK_SEND_MESSAGE", label: "Send message", args: {} },
  ],
});
const edit = (value: unknown) => editSchema.parse(value);

it("rejects decision rules that point to an unlisted case", () => {
  const decision = { id: "d1", kind: "decide", label: "Pick", cases: ["support"], rules: [{ $step: "s1", op: "exists", case: "sales" }] };
  expect(workflowSchema.safeParse({ ...base, steps: [base.steps[0], decision] }).success).toBe(false);
  expect(workflowSchema.safeParse({ ...base, steps: [base.steps[0], { ...decision, rules: undefined, prompt: "Pick", otherwise: "sales" }] }).success).toBe(false);
});

it("shows case restrictions and checks for delegated and decision steps", () => {
  const workflow = workflowSchema.parse({ ...base, steps: [base.steps[0], { id: "d1", kind: "decide", label: "Pick", cases: ["support"], prompt: "Pick" }, { id: "s2", kind: "delegate", label: "Ask", tasks: [{ bot: { name: "Rui" }, message: "Inspect" }], when: onCase("d1", "support"), check: { says: "reply exists" } }] });
  expect(renderWorkflowSkillMd("fixture", workflow)).toContain('[only when d1 is "support"] Teammates:');
  expect(renderWorkflowSkillMd("fixture", workflow)).toContain("done when: reply exists");
});

it("keeps undo tokens scoped to the skill location and expires them", () => {
  let now = 1_000;
  const undo = createEditUndo(() => now);
  const id = undo.keep("sort-email", base, "sha", "bot:a");
  expect(undo.take(id, "bot:b", "sort-email")).toBeNull();
  expect(undo.take(id, "bot:a", "other")).toBeNull();
  expect(undo.take(id, "bot:a", "sort-email")).toMatchObject({ name: "sort-email" });
  const expired = undo.keep("sort-email", base, "sha", "bot:a");
  now += 24 * 60 * 60_000 + 1;
  expect(undo.peek(expired)).toBeNull();
  expect(undo.take(expired, "bot:a", "sort-email")).toBeNull();
});

describe("changing a saved Skill Burger's steps", () => {
  it("rejects case steps whose existing conditions would be overwritten", () => {
    const change = edit({ action: "add_case", decide: { after: "s1" }, case: "support", steps: [{ id: "x", kind: "app", app: "gmail", tool: "GMAIL_SEND_EMAIL", label: "Send", args: {}, when: { $step: "s1", op: "exists" } }] });
    expect(applyEdit(base, change)).toMatchObject({ error: expect.stringContaining("cannot safely combine") });
  });
  it("refuses to add a ninth case", () => {
    const workflow = workflowSchema.parse({ ...base, steps: [base.steps[0], { id: "d1", kind: "decide", label: "Choose", cases: ["one", "two", "three", "four", "five", "six", "seven", "eight"], prompt: "Choose" }] });
    expect(applyEdit(workflow, edit({ action: "add_case", decide: { id: "d1" }, case: "nine", steps: [] }))).toMatchObject({ error: expect.stringContaining("8 cases") });
  });
  it("adds a case in words: a new fork after a step, with its steps tagged for the case and their refs renumbered", () => {
    const next = applyEdit(base, edit({
      action: "add_case", decide: { after: "s1", label: "Is it support?", prompt: "Is this email a support request?", input: { $step: "s1" } }, case: "support",
      steps: [
        { id: "x", kind: "app", app: "linear", tool: "LINEAR_CREATE_ISSUE", label: "Create issue", args: { title: { $step: "s1", path: "subject" } } },
        { id: "y", kind: "app", app: "slack", tool: "SLACK_SEND_MESSAGE", label: "Tell support", args: { text: { $step: "x", path: "url" } } },
      ],
    }));
    if ("error" in next) throw new Error(next.error);
    expect(next.steps.map((step) => [step.id, step.kind, caseOf(step)?.case ?? null])).toEqual([
      ["s1", "app", null], ["d1", "decide", null], ["c1", "app", "support"], ["c2", "app", "support"], ["s2", "app", null],
    ]);
    expect(next.steps[3]).toMatchObject({ args: { text: { $step: "c1", path: "url" } } });
    expect(workflowSchema.safeParse(next).success).toBe(true);

    const more = applyEdit(next, edit({ action: "add_case", decide: { id: "d1" }, case: "sales", steps: [{ kind: "app", app: "hubspot", tool: "HUBSPOT_CREATE_DEAL", label: "Create deal", args: {} }] }));
    if ("error" in more) throw new Error(more.error);
    expect(more.steps.find((step) => step.id === "d1")).toMatchObject({ cases: ["support", "sales"] });
    expect(more.steps.map((step) => step.id)).toEqual(["s1", "d1", "c1", "c2", "c3", "s2"]);

    const fewer = applyEdit(more, edit({ action: "remove_case", decide: "d1", case: "support" }));
    if ("error" in fewer) throw new Error(fewer.error);
    expect(fewer.steps.map((step) => step.id)).toEqual(["s1", "d1", "c3", "s2"]);
    const none = applyEdit(fewer, edit({ action: "remove_case", decide: "d1", case: "sales" }));
    if ("error" in none) throw new Error(none.error);
    expect(none.steps.map((step) => step.id)).toEqual(["s1", "s2"]);
  });

  it("puts a condition on a step and takes it off, and refuses a step that can't run", () => {
    const when = { $step: "s1", path: "messages.0", op: "exists" };
    const guarded = applyEdit(base, edit({ action: "set_when", step: "s2", when }));
    expect(guarded).toMatchObject({ steps: [{ id: "s1" }, { id: "s2", when }] });
    const open = applyEdit(guarded as Workflow, edit({ action: "set_when", step: "s2", when: null }));
    expect((open as Workflow).steps[1]).not.toHaveProperty("when");
    expect(applyEdit(base, edit({ action: "add_case", decide: { after: "s1" }, case: "x", steps: [{ kind: "teleport" }] }))).toHaveProperty("error");
  });
});

describe("decisions the bot stated, made part of the saved burger", () => {
  it("refuses to save a case when the same step already has a condition", () => {
    const decisions = parseDecisions('```json\n{"conditions":[{"step":"s2","when":{"$step":"s1","path":"messages.0","op":"exists"}}],"fork":{"after":"s1","question":"Support or sales?","cases":["support","sales"],"taken":"support","steps":["s2"]}}\n```');
    expect(() => applyDecisions(base, decisions)).toThrow("cannot safely combine");
  });

  it("changes nothing for {} or for decisions that don't fit the steps", () => {
    expect(applyDecisions(base, parseDecisions("{}"))).toEqual(base);
    expect(applyDecisions(base, parseDecisions("not json"))).toEqual(base);
    expect(applyDecisions(base, parseDecisions('{"conditions":[{"step":"s1","when":{"$step":"s2","op":"exists"}}]}'))).toEqual(base);
    expect(applyDecisions(base, parseDecisions('{"fork":{"after":"s2","question":"?","cases":["a","b"],"taken":"a","steps":["s1"]}}'))).toEqual(base);
  });
});
