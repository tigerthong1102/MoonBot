import { join } from "node:path";
import { z } from "zod";

import { RUN_STEP_MARK } from "../../shared/skill-burger/layers.ts";
import type { WorkflowStep } from "../../shared/skill-burger/format.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { applyEdit, editSchema, editUndo, undoScope } from "./edit.ts";
import { createExecutors, type ExecutorContext } from "./executors.ts";
import { authorizeWorkflowAction, checkedExecutors, guardedExecutors, type WorkflowGuard } from "./guarded-executors.ts";
import { createRunHistory } from "./history.ts";
import { createRunStates } from "./run-state.ts";
import { resumeRun, startRun, type RunDeps, type RunEnvelope, type StepExecutors, type StepResult } from "./runner.ts";
import { findWorkflowSkill, replaceWorkflowSkill } from "./store.ts";
import { burgerTurn, type BurgerHostDeps, type CallingTurn } from "./turn-host.ts";

export const RUN_PATH = "/api/internal/skill-burgers/run";
export const RESUME_PATH = "/api/internal/skill-burgers/resume";
export const EDIT_PATH = "/api/internal/skill-burgers/edit";
export const UNDO_PATH = "/api/internal/skill-burgers/undo";

/** What a run's step rows publish: the chat's own tool events, which the server turns into activity rows. */
export interface StepEvent {
  type: "item.started" | "item.completed";
  itemId: string;
  title?: string;
  input?: string;
  ok?: boolean;
  output?: string;
}

export interface BurgerTurn extends Pick<ExecutorContext, "internal"> {
  botId: string;
  threadId: string;
  cwd: string;
  signal?: AbortSignal;
  assignedSkills?: readonly string[];
  guard?: WorkflowGuard;
  publish(event: StepEvent): void;
  /** A burger used in every chat belongs to the whole place: whether this turn may change one. */
  mayEditEveryChat: boolean;
  mayEditBot?: boolean;
  sharedSkillsEnabled?: boolean;
}

const runBody = z.object({ name: z.string().min(1).max(64), args: z.record(z.string(), z.unknown()).optional() }).strict();
const resumeBody = z.object({ run: z.string().min(1).max(100), response: z.string().max(20_000) }).strict();
const undoBody = z.object({ undo: z.string().min(1).max(64) }).strict();

const DETAIL_MAX = 6_000;
/** A step's detail as its row carries it: a few replies of a few hundred characters, never the whole of them. */
function boundedDetail(detail: StepResult["detail"]): StepResult["detail"] {
  if (!detail?.replies) return detail;
  const each = Math.floor(DETAIL_MAX / Math.max(1, detail.replies.length));
  return { ...detail, replies: detail.replies.slice(0, 8).map((reply) => ({ ...reply, text: reply.text.slice(0, Math.min(600, each)) })) };
}

/** The step rows a run publishes, each started before it ends, even a step the run passed over. */
function stepEvents(turn: BurgerTurn, open: Map<string, Set<string>>): RunDeps["events"] {
  const itemId = (run: string, step: WorkflowStep) => `burger-${run}-${step.id}`;
  const start = (run: string, name: string, step: WorkflowStep) => {
    const seen = open.get(run) ?? new Set<string>();
    open.set(run, seen);
    if (seen.has(step.id)) return;
    seen.add(step.id);
    turn.publish({ type: "item.started", itemId: itemId(run, step), title: step.label, input: JSON.stringify({ [RUN_STEP_MARK]: run, name, step: step.id }) });
  };
  return {
    started: start,
    ended(run: string, name: string, step: WorkflowStep, result: StepResult) {
      start(run, name, step);
      turn.publish({
        type: "item.completed", itemId: itemId(run, step), ok: result.state !== "failed",
        output: JSON.stringify({ state: result.state, ...(result.case ? { case: result.case } : {}), ...(result.error ? { error: result.error } : {}), ...(result.detail ? { detail: boundedDetail(result.detail) } : {}) }),
      });
    },
  };
}

export function createSkillBurgerRuns(deps: { dataDir: string; root?: string; host?: BurgerHostDeps; executors?: (turn: BurgerTurn) => StepExecutors }) {
  const states = createRunStates(join(deps.dataDir, "skill-burger-runs"));
  const history = createRunHistory(join(deps.dataDir, "skill-burger-runs"));
  const open = new Map<string, Set<string>>();
  const runDeps = (turn: BurgerTurn): RunDeps => {
    const exec = deps.executors?.(turn) ?? createExecutors({ botId: turn.botId, cwd: turn.cwd, internal: turn.internal });
    const noop: StepExecutors = { shell: async () => ({ ok: true, output: null }), app: async () => ({ ok: true, output: null }), browser: async () => ({ ok: true, output: null }), file: async () => ({ ok: true, output: null }) };
    return {
    exec: turn.guard ? guardedExecutors(exec, turn.guard) : exec,
    ...(turn.guard ? { authorizationExec: guardedExecutors(noop, turn.guard), actionExec: checkedExecutors(exec, turn.guard) } : {}),
    events: stepEvents(turn, open),
    save: (state, preserve) => states.save(state, preserve),
    signal: turn.signal,
    fileViaBot: Boolean(turn.guard),
    };
  };
  const finished = (turn: BurgerTurn, name: string | undefined, envelope: RunEnvelope) => {
    if (envelope.status !== "needs_input") open.delete(envelope.run);
    if (name) history.record({ name, botId: turn.botId, threadId: turn.threadId }, envelope);
    return envelope;
  };

  const internalRoutes = (turn: BurgerTurn): RouteHandler => async ({ req, res, path, method, json, readBody }) => {
    if (method !== "POST" || ![RUN_PATH, RESUME_PATH, EDIT_PATH, UNDO_PATH].includes(path)) return PASS;
    const body = await readBody(req);
    if ((path === EDIT_PATH || path === UNDO_PATH) && turn.guard && !await authorizeWorkflowAction(turn.guard, "edit", "workflow_edit", body, turn.signal ?? new AbortController().signal)) {
      return json(res, 403, { error: "Permission denied, unavailable, or expired; the workflow was not changed." });
    }
    if (path === RUN_PATH) {
      const parsed = runBody.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "run_workflow needs the Skill Burger's name." });
      const found = findWorkflowSkill(turn.botId, parsed.data.name, deps.root, turn.assignedSkills, turn.sharedSkillsEnabled);
      if (!found) return json(res, 404, { error: `No Skill Burger named "${parsed.data.name}" here. Check the names in your skills index.` });
      const envelope = await startRun({ name: parsed.data.name, botId: turn.botId, threadId: turn.threadId, sha256: found.sha256, workflow: found.workflow, ...(parsed.data.args ? { args: parsed.data.args } : {}) }, runDeps(turn));
      return json(res, 200, finished(turn, parsed.data.name, envelope));
    }
    if (path === RESUME_PATH) {
      const parsed = resumeBody.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "Resume needs the run's token and your response." });
      const state = states.take(parsed.data.run, turn.botId, turn.threadId);
      if (!state) return json(res, 404, { error: "That run can't be resumed: it finished, was resumed already, or is more than a day old." });
      const current = findWorkflowSkill(turn.botId, state.name, deps.root, turn.assignedSkills, turn.sharedSkillsEnabled);
      if (!current || current.sha256 !== state.sha256) {
        states.save(state, true);
        return json(res, 409, { error: "This workflow is unavailable or changed since it paused; review it before starting again." });
      }
      return json(res, 200, finished(turn, state.name, await resumeRun(state, parsed.data.response, runDeps(turn))));
    }
    if (path === UNDO_PATH) {
      const parsed = undoBody.safeParse(body);
      if (!parsed.success) return json(res, 404, { error: "There is nothing to undo with that id." });
      const kept = editUndo.peek(parsed.data.undo);
      if (!kept) return json(res, 404, { error: "There is nothing to undo with that id." });
      const found = findWorkflowSkill(turn.botId, kept.name, deps.root, turn.assignedSkills, turn.sharedSkillsEnabled);
      if (!found) return json(res, 404, { error: "That Skill Burger is gone." });
      if ("everyChat" in found.place && !turn.mayEditEveryChat) return json(res, 403, { error: "Only an admin of this installation can change a Skill Burger used in every chat." });
      if ("botId" in found.place && turn.mayEditBot !== true) return json(res, 403, { error: "Edit this workflow through the bot's settings with an authorized account." });
      if (!editUndo.take(parsed.data.undo, undoScope(found.place), kept.name)) return json(res, 404, { error: "There is nothing to undo with that id." });
      const restored = replaceWorkflowSkill({ place: found.place, name: kept.name, workflow: kept.previous, sha256: kept.sha256, root: deps.root });
      if ("stale" in restored) return json(res, 409, { error: "The Skill Burger changed since; undo isn't safe now." });
      return "error" in restored ? json(res, 422, restored) : json(res, 200, { skill: restored });
    }
    const raw = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const name = typeof raw.name === "string" ? raw.name : "";
    const { name: _name, ...rest } = raw;
    const edit = editSchema.safeParse(rest);
    if (!name || !edit.success) return json(res, 400, { error: `workflow_edit needs name and a change: ${edit.success ? "name" : edit.error.issues[0]?.message ?? ""}` });
    const found = findWorkflowSkill(turn.botId, name, deps.root, turn.assignedSkills, turn.sharedSkillsEnabled);
    if (!found) return json(res, 404, { error: `No Skill Burger named "${name}" here.` });
    if ("everyChat" in found.place && !turn.mayEditEveryChat) return json(res, 403, { error: "Only an admin of this installation can change a Skill Burger used in every chat." });
    if ("botId" in found.place && turn.mayEditBot !== true) return json(res, 403, { error: "Edit this workflow through the bot's settings with an authorized account." });
    const next = applyEdit(found.workflow, edit.data);
    if ("error" in next) return json(res, 422, next);
    const saved = replaceWorkflowSkill({ place: found.place, name, workflow: next, sha256: found.sha256, root: deps.root });
    if ("stale" in saved) return json(res, 409, { error: "The Skill Burger changed meanwhile; read it again and retry." });
    if ("error" in saved) return json(res, 422, saved);
    return json(res, 200, { skill: saved, undo: editUndo.keep(name, found.workflow, saved.sha256, undoScope(found.place)) });
  };

  /** The routes for one agents tool call: `authorization` is the bearer it came with. */
  const routesFor = (calling: CallingTurn, authorization: string | undefined, signal?: AbortSignal): RouteHandler => (ctx) => {
    if (ctx.method !== "POST" || ![RUN_PATH, RESUME_PATH, EDIT_PATH, UNDO_PATH].includes(ctx.path) || !deps.host) return Promise.resolve(PASS);
    if (!deps.host.available() || !deps.host.guard) return Promise.resolve(ctx.json(ctx.res, 404, { error: "No such route." }));
    return internalRoutes(burgerTurn(deps.host, calling, authorization, signal))(ctx);
  };

  /** For a turn the teammates' replies resume: the line that sends it back into the run it paused for them. */
  const waitingNote = (threadId: string, handoffs: readonly string[]): string | null => {
    const waiting = states.waitingIn(threadId, handoffs);
    return waiting ? `These replies are for the Skill Burger "${waiting.name}": first call run_workflow with resume ${JSON.stringify(waiting.pauseToken ?? waiting.id)} and response "back", then do what it says.` : null;
  };

  return { internalRoutes, routesFor, history, waitingNote };
}
export type SkillBurgerRuns = ReturnType<typeof createSkillBurgerRuns>;
