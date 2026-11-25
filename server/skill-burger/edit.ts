import { randomUUID } from "node:crypto";
import { z } from "zod";

import { caseName, caseOf, onCase, workflowStepSchema, type Workflow, type WorkflowStep } from "../../shared/skill-burger/format.ts";
import { needsOf, renameArg } from "../../shared/skill-burger/draft-view.ts";

const condition = z.object({ $step: z.string(), path: z.string().max(200).optional(), op: z.enum(["eq", "ne", "gt", "lt", "exists"]), value: z.unknown().optional() }).strict();

export const editSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_case"),
    decide: z.object({
      id: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
      after: z.string().optional(),
      label: z.string().min(1).max(120).optional(),
      prompt: z.string().min(1).max(2_000).optional(),
      input: z.object({ $step: z.string(), path: z.string().max(200).optional() }).strict().optional(),
    }).strict(),
    case: caseName,
    steps: z.array(z.unknown()).max(20),
  }).strict(),
  z.object({ action: z.literal("remove_case"), decide: z.string(), case: caseName }).strict(),
  z.object({ action: z.literal("set_when"), step: z.string(), when: condition.nullable() }).strict(),
]);
export type WorkflowEdit = z.infer<typeof editSchema>;

export function mergeDraftInputs(workflow: Workflow, draft: Workflow): { workflow: Workflow; steps: WorkflowStep[] } {
  const args = { ...workflow.args };
  const reserved = new Set([...Object.keys(args), ...Object.keys(draft.args)]);
  let steps = draft.steps;
  for (const [name, arg] of Object.entries(draft.args)) {
    let target = name;
    if (name in args) {
      let number = 2;
      do { const suffix = `_${number++}`; target = name.slice(0, 40 - suffix.length) + suffix; } while (reserved.has(target));
      reserved.add(target);
      steps = renameArg(steps, name, target);
    }
    args[target] = arg;
  }
  return { workflow: { ...workflow, args }, steps };
}

const nextId = (workflow: Workflow, stem: string) => {
  const taken = new Set(workflow.steps.map((step) => step.id));
  for (let n = 1; ; n += 1) if (!taken.has(`${stem}${n}`)) return `${stem}${n}`;
};

function rewriteRefs(node: unknown, renamed: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(node)) return node.map((item) => rewriteRefs(item, renamed));
  if (!node || typeof node !== "object") return node;
  const record = node as Record<string, unknown>;
  if (typeof record.$step === "string" && renamed.has(record.$step)) return { ...record, $step: renamed.get(record.$step) };
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, key === "id" ? value : rewriteRefs(value, renamed)]));
}

export function applyEdit(workflow: Workflow, edit: WorkflowEdit): Workflow | { error: string } {
  const steps = [...workflow.steps];
  if (edit.action === "set_when") {
    const at = steps.findIndex((step) => step.id === edit.step);
    if (at < 0) return { error: `there is no step ${edit.step}` };
    if (edit.when && !steps.slice(0, at).some((step) => step.id === edit.when!.$step)) return { error: "The condition must reference an earlier step." };
    const { when: _old, ...rest } = steps[at]!;
    steps[at] = (edit.when ? { ...rest, when: edit.when } : rest) as WorkflowStep;
    return { ...workflow, steps };
  }
  if (edit.action === "remove_case") {
    const at = steps.findIndex((step) => step.id === edit.decide);
    const decide = steps[at];
    if (decide?.kind !== "decide") return { error: `there is no decide step ${edit.decide}` };
    const kept = steps.filter((step) => { const on = caseOf(step); return !(on?.decide === edit.decide && on.case === edit.case); });
    const cases = decide.cases.filter((one) => one !== edit.case);
    const rules = decide.rules?.filter((rule) => rule.case !== edit.case);
    const next = { ...decide, cases, ...(rules ? { rules } : {}), ...(decide.otherwise === edit.case ? { otherwise: undefined } : {}) };
    const remaining = cases.length ? kept.map((step) => (step.id === edit.decide ? next : step)) : kept.filter((step) => step.id !== edit.decide);
    const removed = new Set(steps.filter((step) => !remaining.some((one) => one.id === step.id)).map((step) => step.id));
    const dependent = remaining.find((step) => needsOf(step).some((id) => removed.has(id)));
    return dependent ? { error: `The step "${dependent.label}" depends on a step in the removed case.` } : { ...workflow, steps: remaining };
  }
  let decideId = edit.decide.id;
  let at = decideId ? steps.findIndex((step) => step.id === decideId) : -1;
  if (decideId && at < 0) return { error: `there is no decide step ${decideId}` };
  if (at >= 0) {
    const decide = steps[at]!;
    if (decide.kind !== "decide") return { error: `step ${decideId} is not a decide step` };
    if (!decide.cases.includes(edit.case)) {
      if (decide.cases.length >= 8) return { error: `decide step ${decideId} already has 8 cases` };
      steps[at] = { ...decide, cases: [...decide.cases, edit.case] };
    }
  } else {
    const after = edit.decide.after ? steps.findIndex((step) => step.id === edit.decide.after) : steps.length - 1;
    if (after < 0) return { error: `there is no step ${edit.decide.after}` };
    decideId = nextId(workflow, "d");
    at = after + 1;
    steps.splice(at, 0, {
      id: decideId, kind: "decide", label: edit.decide.label ?? "Which case is it", cases: [edit.case],
      prompt: edit.decide.prompt ?? `Which case is this? ${edit.decide.label ?? ""}`.trim(), ...(edit.decide.input ? { input: edit.decide.input } : {}),
    });
  }
  const end = (() => {
    let last = at;
    for (let index = at + 1; index < steps.length; index += 1) if (caseOf(steps[index]!)?.decide === decideId) last = index;
    return last;
  })();
  const added: WorkflowStep[] = [];
  const renamed = new Map<string, string>();
  for (const raw of edit.steps) {
    if (raw && typeof raw === "object" && "when" in raw && raw.when != null) return { error: "A step cannot safely combine a condition with a case." };
    const id = nextId({ ...workflow, steps: [...steps, ...added] }, "c");
    const own = (raw as { id?: unknown }).id;
    if (typeof own === "string") renamed.set(own, id);
    const checked = workflowStepSchema.safeParse({ ...(rewriteRefs(raw, renamed) as object), id, when: onCase(decideId!, edit.case) });
    if (!checked.success) return { error: `a step isn't one a Skill Burger can run: ${checked.error.issues[0]?.message ?? "invalid"}` };
    added.push(checked.data);
  }
  steps.splice(end + 1, 0, ...added);
  return { ...workflow, steps };
}

export function insertFix(workflow: Workflow, id: string, fix: readonly WorkflowStep[]): Workflow | { error: string } {
  const at = workflow.steps.findIndex((step) => step.id === id);
  if (at < 0) return { error: `there is no step ${id}` };
  if (!fix.length) return { error: "there is no fix to keep" };
  if (workflow.steps.length + fix.length > 40) return { error: "the Skill Burger would have more than 40 steps" };
  const renamed = new Map<string, string>();
  const taken = new Set(workflow.steps.map((step) => step.id));
  for (const step of fix) {
    let n = 1;
    while (taken.has(`${id}_fix${n}`)) n += 1;
    renamed.set(step.id, `${id}_fix${n}`);
    taken.add(`${id}_fix${n}`);
  }
  const fixed = workflow.steps[at]!;
  const added: WorkflowStep[] = [];
  for (const step of fix) {
    const checked = workflowStepSchema.safeParse({ ...(rewriteRefs(step, renamed) as object), id: renamed.get(step.id), ...(fixed.when ? { when: fixed.when } : {}) });
    if (!checked.success) return { error: `a fix step isn't one a Skill Burger can run: ${checked.error.issues[0]?.message ?? "invalid"}` };
    added.push(checked.data);
  }
  return { ...workflow, steps: [...workflow.steps.slice(0, at), ...added, ...workflow.steps.slice(at)] };
}

export function createEditUndo(now: () => number = Date.now) {
  const kept = new Map<string, { name: string; previous: Workflow; sha256: string; scope: string; at: number }>();
  const peek = (id: string) => {
    const entry = kept.get(id);
    if (!entry || now() - entry.at > 24 * 60 * 60_000 || now() < entry.at) {
      kept.delete(id);
      return null;
    }
    return entry;
  };
  return {
    keep(name: string, previous: Workflow, sha256: string, scope: string): string {
      for (const [id, entry] of kept) if (now() - entry.at > 24 * 60 * 60_000) kept.delete(id);
      while (kept.size >= 1_000) kept.delete(kept.keys().next().value!);
      const id = randomUUID();
      kept.set(id, { name, previous, sha256, scope, at: now() });
      return id;
    },
    peek,
    take(id: string, scope: string, name: string): { name: string; previous: Workflow; sha256: string } | null {
      const entry = peek(id);
      if (!entry || entry.scope !== scope || entry.name !== name) return null;
      kept.delete(id);
      return entry;
    },
  };
}
export const undoScope = (place: { botId: string } | { everyChat: true }): string => "botId" in place ? `bot:${place.botId}` : "every-chat";
export type EditUndo = ReturnType<typeof createEditUndo>;
export const editUndo = createEditUndo();
