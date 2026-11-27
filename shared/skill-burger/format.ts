import { delegateMessage, HANDOFF_TOO_LONG, handoffFits, resultContract } from "./result-contract.ts";
import { z } from "zod";

import { KNOWN_READ_SLUGS } from "../outbound.ts";
import { appLabel } from "./apps.ts";

export const WORKFLOW_FILE = "workflow.json";
export const WORKFLOW_TAG = "workflow";
export const WORKFLOW_MAX_STEPS = 40;
export const WORKFLOW_MAX_BYTES = 256 * 1024;
export const SUMMARY_MAX = 160;

const ref = z.union([
  z.object({ $arg: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/) }).strict(),
  z.object({ $step: z.string().regex(/^[a-z0-9_]{1,40}$/), path: z.string().max(200).optional() }).strict(),
]);
export type WorkflowRef = z.infer<typeof ref>;

export const workflowCondition = z.object({
  $step: z.string(), path: z.string().max(200).optional(), op: z.enum(["eq", "ne", "gt", "lt", "exists"]), value: z.unknown().optional(),
}).strict();

/** Text with values in it: plain text, or parts where an arg or an earlier step's output fills a gap. Never a template
 * string, so a value can't change the words around it. */
const text = z.union([z.string().min(1).max(8_000), z.array(z.union([z.string().max(8_000), ref])).min(1).max(40)]);
export type WorkflowText = z.infer<typeof text>;
const literalText = (value: WorkflowText) => typeof value === "string" ? value : value.filter(part => typeof part === "string").join("");

/** What "done" means for a step: `says` in words, and, where a rule on the step's own output can tell, that rule. A step
 * with a rule fails when the rule doesn't hold; one with words only is checked by the bot. `true` means "does this look right". */
export const checkSchema = z.union([
  z.boolean(),
  z.object({
    says: z.string().min(1).max(1_000),
    rule: z.object({ path: z.string().max(200).optional(), op: z.enum(["eq", "ne", "gt", "lt", "exists"]), value: z.unknown().optional() }).strict().optional(),
  }).strict(),
]);
export type WorkflowCheck = z.infer<typeof checkSchema>;

/** A teammate a delegation goes to: its id where it ran, its name and role so another bot can take its place. */
const teammate = z.object({ id: z.string().min(1).max(128).optional(), name: z.string().min(1).max(80), role: z.string().max(120).optional() }).strict();
export type WorkflowTeammate = z.infer<typeof teammate>;
export const DELEGATE_MAX_ROUNDS = 3;

const common = {
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().min(1).max(120),
  when: workflowCondition.optional(),
  approval: z.string().trim().min(1).max(500).optional(),
  parallelWithPrevious: z.literal(true).optional(),
  timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
  check: checkSchema.optional(),
  /** Where it ran, so a replay runs it in the same place: an app, the browser, the bot's computer, a cloud computer (VM), the person's computer. */
  where: z.enum(["app", "browser", "bot", "vm", "yourComputer"]).optional(),
};

/** A case's name: a few plain words, as the person or the bot would say them ("support", "a refund"). */
export const caseName = z.string().trim().min(1).max(40).regex(/^[\p{L}\p{N}][\p{L}\p{N} '&-]*$/u);

/** One rule of a decide step: when an earlier step's output matches, the run takes `case`. */
const caseRule = workflowCondition.extend({ case: caseName });

const PLACE: Record<string, string> = { vm: "on the cloud computer", yourComputer: "on the person's own computer", browser: "in the browser" };

const fieldName = z.string().min(1).max(80).regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .refine(name => !["__proto__", "constructor", "prototype"].includes(name));
const fieldPath = z.string().min(1).max(200).refine(path => path.split(".").every(part => /^\d+$/.test(part) || fieldName.safeParse(part).success));
export const readBatchSchema = z.object({
  rows: ref, column: fieldPath, argument: fieldName, select: fieldPath,
}).strict();
export const WORKFLOW_BATCH_LIMIT = 100;

export const workflowStepSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("shell"), run: z.string().min(1).max(20_000), cwd: z.string().max(1_000).optional(), stdin: ref.optional(), shell: z.enum(["bash", "unknown"]).optional() }).strict(),
  z.object({ ...common, kind: z.literal("app"), resultContract: resultContract.optional(), app: z.string().min(1).max(64), tool: z.string().min(1).max(200), args: z.record(z.string(), z.unknown()), batch: readBatchSchema.optional(), account: z.string().max(200).optional() }).strict(),
  z.object({ ...common, kind: z.literal("browser"), action: z.literal("open"), url: z.union([z.string().url(), ref]) }).strict(),
  z.object({ ...common, kind: z.literal("file"), path: z.string().min(1).max(1_000), content: z.union([z.string(), ref]) }).strict(),
  z.object({
    ...common, kind: z.literal("ai"), deterministic: z.literal(false), prompt: z.string().min(1).max(4_000),
    input: ref.optional(), example: z.string().max(4_000).optional(),
  }).strict(),
  // A fork: rules on an earlier step's output pick a case, or the AI picks one by judgement. Steps for a case carry
  // `when: {"$step": <decide id>, "path": "case", "op": "eq", "value": <case>}`; the run takes only that case's steps.
  // Work handed to teammates at once, each with its own message: the run waits for every reply. `review` lets the bot
  // send a reply that falls short of its done-when back for up to `rounds` more rounds; `example` is what the extra round
  // asked last time.
  z.object({
    ...common, kind: z.literal("delegate"),
    tasks: z.array(z.object({ bot: teammate, message: text, resultContract: resultContract.optional(), doneWhen: text.or(z.literal("")).refine((value) => literalText(value).length <= 1_000).optional() }).strict()).min(1).max(8).refine((tasks) => new Set(tasks.map((task) => task.bot.name.trim().toLowerCase().replace(/^@/, ""))).size === tasks.length, "Each delegated task needs a distinct teammate name."),
    consult: z.boolean().optional(),
    review: z.object({ rounds: z.number().int().min(1).max(DELEGATE_MAX_ROUNDS), example: z.string().max(2_000).optional() }).strict().optional(),
  }).strict(),
  z.object({
    ...common, kind: z.literal("decide"), cases: z.array(caseName).min(1).max(8),
    rules: z.array(caseRule).max(16).optional(), otherwise: caseName.optional(),
    prompt: z.string().min(1).max(2_000).optional(), input: ref.optional(),
  }).strict(),
]);
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const WORKFLOW_PARALLEL_LIMIT = 4;

/** Only known read-only connector operations can share a wave. Unknown or plain proxy tools stay sequential. */
export function parallelRead(step: WorkflowStep | undefined): boolean {
  return step?.kind === "app" && !step.batch && KNOWN_READ_SLUGS.has(step.tool) && step.app.toLowerCase() === step.tool.split("_")[0]?.toLowerCase()
    && (!step.where || step.where === "app") && !step.when && !step.approval && !step.check;
}

function references(node: unknown, ids: Set<string>): boolean {
  if (!node || typeof node !== "object") return false;
  if ("$step" in node && typeof node.$step === "string" && ids.has(node.$step)) return true;
  return Object.values(node).some(value => references(value, ids));
}

export function parallelProblem(steps: WorkflowStep[]): string | null {
  if (steps.length < 2 || steps.length > WORKFLOW_PARALLEL_LIMIT || steps.some(step => !parallelRead(step))) {
    return "A parallel group needs two to four independent read-only app steps, without checks or approval gates.";
  }
  const ids = new Set(steps.map(step => step.id));
  return steps.some(step => step.kind === "app" && references(step.args, ids)) ? "A parallel step cannot depend on another step in the same group." : null;
}

export const workflowSchema = z.object({
  version: z.literal(1),
  summary: z.string().min(1).max(SUMMARY_MAX),
  args: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.object({ default: z.unknown().optional(), label: z.string().max(80).optional() }).strict()),
  steps: z.array(workflowStepSchema).min(1).max(WORKFLOW_MAX_STEPS),
}).strict().superRefine((workflow, issue) => {
  const seen = new Map<string, WorkflowStep>();
  for (let index = 0; index < workflow.steps.length; index++) {
    const step = workflow.steps[index]!;
    if (step.parallelWithPrevious && index === 0) issue.addIssue({ code: "custom", message: "The first step has no preceding parallel step." });
    if (!step.parallelWithPrevious && workflow.steps[index + 1]?.parallelWithPrevious) {
      let end = index + 1;
      while (workflow.steps[end]?.parallelWithPrevious) end++;
      const problem = parallelProblem(workflow.steps.slice(index, end));
      if (problem) issue.addIssue({ code: "custom", message: problem });
    }
    if (step.kind === "delegate") {
      for (const [taskIndex, task] of step.tasks.entries()) {
        if (task.resultContract && !handoffFits({ botIds: [task.bot.id ?? ""], message: delegateMessage(literalText(task.message), task.resultContract),
          doneWhen: task.doneWhen ? literalText(task.doneWhen) : undefined, consult: step.consult || undefined })) {
          issue.addIssue({ code: "custom", path: ["steps", index, "tasks", taskIndex], message: HANDOFF_TOO_LONG });
        }
      }
    }
    if (step.kind === "app" && step.batch) {
      if (step.resultContract) issue.addIssue({ code: "custom", message: "A batch returns a row ledger. Apply a scalar result contract to a single read." });
      const { rows, argument } = step.batch;
      if (!KNOWN_READ_SLUGS.has(step.tool) || step.app.toLowerCase() !== step.tool.split("_")[0]?.toLowerCase() || (step.where && step.where !== "app")) {
        issue.addIssue({ code: "custom", message: "A batch requires a known read-only connector tool." });
      }
      if (Object.hasOwn(step.args, argument) || ("$arg" in rows ? !Object.hasOwn(workflow.args, rows.$arg) : !seen.has(rows.$step))) {
        issue.addIssue({ code: "custom", message: "Choose a declared row source and an unused tool argument." });
      }
    }
    if (seen.has(step.id)) issue.addIssue({ code: "custom", message: `step id ${step.id} is used twice` });
    if (step.kind === "decide" && !step.rules?.length && !step.prompt) issue.addIssue({ code: "custom", message: `decide step ${step.id} needs rules or a prompt` });
    if (step.kind === "decide") {
      for (const rule of step.rules ?? []) if (!step.cases.includes(rule.case)) issue.addIssue({ code: "custom", message: `decide step ${step.id} has a rule for an unknown case` });
      if (step.otherwise && !step.cases.includes(step.otherwise)) issue.addIssue({ code: "custom", message: `decide step ${step.id} has an unknown otherwise case` });
    }
    const fork = caseOf(step);
    if (fork) {
      const decide = seen.get(fork.decide);
      if (decide?.kind !== "decide") issue.addIssue({ code: "custom", message: `step ${step.id} follows a case of ${fork.decide}, which is no earlier decide step` });
      else if (!decide.cases.includes(fork.case)) issue.addIssue({ code: "custom", message: `step ${step.id} follows case "${fork.case}", which ${fork.decide} doesn't have` });
    }
    seen.set(step.id, step);
  }
});
export type Workflow = z.infer<typeof workflowSchema>;

/** The decide step and case a step belongs to, read from its `when`; null for a step every run takes. */
export function caseOf(step: Pick<WorkflowStep, "when">): { decide: string; case: string } | null {
  const when = step.when;
  if (!when || when.path !== "case" || when.op !== "eq" || typeof when.value !== "string") return null;
  return { decide: when.$step, case: when.value };
}

/** The `when` that puts a step on one case of a decide step. */
export const onCase = (decide: string, name: string) => ({ $step: decide, path: "case", op: "eq" as const, value: name });

/** A skill name from the summary's first words: lowercase, hyphens, unique among `taken`. */
export function workflowSkillName(summary: string, taken: ReadonlySet<string>): string {
  const words = summary.toLowerCase().replace(/['’]/gu, "").normalize("NFKD").replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/[^a-z0-9\s-]/g, "").split(/[\s-]+/).filter(Boolean);
  const stem = words.slice(0, 6).join("-").slice(0, 48).replace(/-+$/, "") || "saved-workflow";
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n += 1) if (!taken.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

const yamlScalar = (value: string) => JSON.stringify(value.replace(/\s+/g, " ").trim());

/** "Kiwi (accessibility tester), Rio and Miso". */
export function teammateNames(tasks: ReadonlyArray<{ bot: WorkflowTeammate }>, roles = true): string {
  const names = [...new Map(tasks.map((task) => [task.bot.name, task.bot])).values()].map((bot) => (roles && bot.role ? `${bot.name} (${bot.role})` : bot.name));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
}

function argsUsed(step: WorkflowStep, args: Workflow["args"]): string {
  const used = Object.keys(args).filter((name) => JSON.stringify(step).includes(`"$arg":"${name}"`));
  return used.length ? ` (${used.map((name) => `${name}${args[name]!.default === undefined ? "" : `, default ${JSON.stringify(args[name]!.default)}`}`).join("; ")})` : "";
}

/** A text's words with each gap named: "QA-test {site}". */
export function textLine(value: WorkflowText): string {
  return typeof value === "string" ? value : value.map((part) => (typeof part === "string" ? part : "$arg" in part ? `{${part.$arg}}` : `{${part.$step}}`)).join("");
}

function stepLine(step: WorkflowStep, args: Workflow["args"]): string {
  const fork = caseOf(step);
  const prefix = (step.approval ? `[wait for human approval: ${step.approval}] ` : "")
    + (step.parallelWithPrevious ? "[parallel read] " : "") + (fork ? `[only when ${fork.decide} is "${fork.case}"] ` : "");
  const done = step.check && typeof step.check === "object" ? ` (done when: ${step.check.says.replace(/\s+/g, " ").slice(0, 200)})` : "";
  if (step.kind === "delegate") {
    const taskDone = [...new Set(step.tasks.flatMap((task) => task.doneWhen ? [textLine(task.doneWhen)] : []))];
    return prefix + [
      `Teammates: ${teammateNames(step.tasks)} each get their part at once (coordinate_bots); wait for every reply${argsUsed(step, args)}`,
      ...step.tasks.map((task) => `   - ${task.bot.name}: ${textLine(task.message).replace(/\s+/g, " ").slice(0, 300)}`),
      ...(taskDone.length ? [`   Done when: ${taskDone.join(" / ")}`] : []),
      ...(step.review ? [`   A reply that falls short goes back, up to ${step.review.rounds} more round${step.review.rounds > 1 ? "s" : ""}${step.review.example ? `; last time: ${step.review.example.replace(/\s+/g, " ").slice(0, 200)}` : ""}`] : []),
    ].join("\n") + done;
  }
  if (step.kind === "decide") return `${prefix}Decide: ${step.label} (${step.cases.map((one) => `"${one}"`).join(", ")})${step.prompt ? " (your judgement)" : ""}${done}`;
  const where = step.kind === "app" ? appLabel(step.app) : step.kind === "ai" ? "AI" : step.kind === "shell" ? "Command" : step.kind === "file" ? "File" : "Browser";
  const used = Object.keys(args).filter((name) => JSON.stringify(step).includes(`"$arg":"${name}"`) || (step.kind === "shell" && step.run.includes(`OMB_ARG_${name.toUpperCase()}`)));
  const detail = used.map((name) => `${args[name]!.label ?? name}: ${name}${args[name]!.default === undefined ? "" : `, default ${JSON.stringify(args[name]!.default)}`}`);
  const what = step.kind === "shell" ? ` \`${step.run.split("\n", 1)[0]!.slice(0, 120)}\`` : step.kind === "app" ? (step.batch ? ` (${step.tool}, up to ${WORKFLOW_BATCH_LIMIT} rows, ${step.batch.column} → ${step.batch.argument}, return ${step.batch.select})` : ` (${step.tool})`) : "";
  const place = step.where && PLACE[step.where] && !(step.kind === "browser" && step.where === "browser") ? ` ${PLACE[step.where]}` : "";
  return `${prefix}${where}${place}: ${step.label}${what}${detail.length ? ` (${detail.join("; ")})` : ""}${step.kind === "ai" ? " (your judgement)" : ""}${done}`;
}

export function renderWorkflowSkillMd(name: string, workflow: Workflow): string {
  const title = workflow.summary.replace(/[.!?]+$/, "");
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${yamlScalar(workflow.summary)}`,
    `tags: ${WORKFLOW_TAG}`,
    "---",
    "",
    `# ${title}`,
    "",
    `A workflow saved from a run in chat. Follow it only when the person requests this workflow. Use the values in ${WORKFLOW_FILE} as reference. Confirm destinations and any actions that change files or external records. Use this conversation's normal tools and approvals for every action.`,
    "",
    ...workflow.steps.map((step, index) => `${index + 1}. ${stepLine(step, workflow.args)}`),
    "",
  ];
  return lines.join("\n");
}
