import { z } from "zod";

import { draftFromLayers, draftWorkflow } from "../../shared/skill-burger/draft.ts";
import { askOf, burgerLayers, type RunMessage } from "../../shared/skill-burger/layers.ts";
import { caseName } from "../../shared/skill-burger/format.ts";
import { applyChoices, draftView } from "../../shared/skill-burger/draft-view.ts";
import { applyEdit, editUndo, insertFix, mergeDraftInputs, undoScope } from "./edit.ts";
import type { RunHistory } from "./history.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { findWorkflowSkill, listWorkflowSkills, readWorkflowSkill, removeWorkflowSkill, renameWorkflowSkill, replaceWorkflowSkill, saveWorkflowSkill, setWorkflowEveryChat, type BurgerPlace } from "./store.ts";
import type { Store } from "../store.ts";

export const SKILL_BURGERS_PATH = "/api/skill-burgers";
export const SKILL_BURGER_DRAFT_PATH = "/api/skill-burger-draft";

export interface SkillBurgerRouteDeps {
  available?(auth: RequestAuth): boolean;
  requiresShareConsent?(auth: RequestAuth): boolean;
  messages(threadId: string): readonly RunMessage[];
  owns(botId: string, threadId: string): boolean;
  sees(auth: RequestAuth, threadId: string): boolean;
  botIds(): readonly string[];
  assignedSkills?(botId: string): readonly string[] | undefined;
  levelOf?(auth: RequestAuth, botId: string): "none" | "view" | "chat" | "edit";
  /** A teammate a run handed work to, by the id or name it used: its name and role now. */
  teammate?(auth: RequestAuth, idOrName: string): { id?: string; name: string; role?: string } | undefined;
  /** Each burger's recent runs. */
  history?: Pick<RunHistory, "list">;
  root?: string;
}

/** A burger used in every chat belongs to the whole place: only an admin turns that on, renames or removes one. */
export const EVERY_CHAT_ADMIN_ONLY = "Only an admin of this installation can change this.";
const NOT_YOURS = "Only people who can edit this bot can change its Skill Burgers.";

const id = z.string().min(1).max(100);
const summaryBody = z.object({ botId: id, threadId: z.string().min(1).max(200) }).strict();
/** What the person changed on the card before saving: steps left out, inputs renamed or given another value. */
const choices = {
  skip: z.array(z.string().max(48)).max(60).optional(),
  inputs: z.record(z.string().max(40), z.object({ name: z.string().max(40).optional(), value: z.string().max(2_000).optional() }).strict()).optional(),
};
const saveBody = z.union([
  z.object({ botId: id, threadId: z.string().min(1).max(200), summary: z.string().max(160).optional(), name: z.string().max(64).optional(), shareConsent: z.literal(true).optional(), ...choices }).strict(),
  // Undo of a removal: the workflow the list read before removing it, put back where it was under its name.
  z.object({ workflow: z.unknown(), name: z.string().max(64), botId: id.optional(), everyChat: z.boolean().optional(), shareConsent: z.literal(true).optional() }).strict(),
]);
const patchBody = z.union([
  z.object({ everyChat: z.boolean(), botId: id.optional(), sha256: z.string().max(64).optional(), shareConsent: z.literal(true).optional() }).strict(),
  z.object({ rename: z.string().min(1).max(64), botId: id.optional(), sha256: z.string().max(64).optional() }).strict(),
  // Undo of a change to the steps: the id that change returned.
  z.object({ undo: z.string().min(1).max(64), botId: id.optional() }).strict(),
]);
/** "Update the burger with this fix": what the bot did to get past a failed step goes in just before that step. */
const fixBody = z.object({ botId: id.optional(), runBotId: id, threadId: z.string().min(1).max(200), run: z.string().min(1).max(64), step: z.string().min(1).max(48), shareConsent: z.literal(true).optional() }).strict();
/** One tap's "Add the path": the steps the bot did by judgement for a case nobody had saved, after the run handed it over. */
const pathBody = z.object({ botId: id.optional(), runBotId: id, threadId: z.string().min(1).max(200), run: z.string().min(1).max(64), decide: z.string().min(1).max(40), case: caseName, shareConsent: z.literal(true).optional() }).strict();

/** The tool rows of the bot's own steps between the run handing over `run` and the run going on: what it did by judgement. */
export function judgementLayers(messages: readonly RunMessage[], run: string, decide: string, label: string, chosen: string, uniqueLabel: boolean) {
  const isRunCall = (message: RunMessage) => message.kind === "activity" && /(?:^|__)run_workflow$/.test(message.tool?.name ?? "");
  const prompt = `The run reached the "${chosen}" case of "${label}", which has no saved steps yet.`;
  const marker = `Workflow case: ${JSON.stringify({ step: decide, case: chosen })}`;
  const handed = messages.findIndex((message) => {
    const output = message.tool?.output ?? "";
    const includes = (value: string) => output.includes(value) || output.includes(value.replaceAll('"', '\\"'));
    return isRunCall(message) && output.includes(run) && (includes(marker) || (uniqueLabel && !output.includes("Workflow case: ") && includes(prompt)));
  });
  if (handed < 0) return [];
  const after = messages.slice(handed + 1);
  const resumed = after.findIndex(isRunCall);
  return burgerLayers(resumed < 0 ? after : after.slice(0, resumed)).filter((layer) => layer.status === "done");
}

/** The tool rows of what the bot did between a run stopping at a failed step and going on from it: its fix. */
export function fixLayers(messages: readonly RunMessage[], run: string, step: string) {
  const isRunCall = (message: RunMessage) => message.kind === "activity" && /(?:^|__)run_workflow$/.test(message.tool?.name ?? "");
  const marker = `Workflow failure: ${JSON.stringify({ step })}`;
  const stopped = messages.findLastIndex((message) => { const output = message.tool?.output ?? ""; return isRunCall(message) && output.includes(run) && (output.includes(marker) || output.includes(marker.replaceAll('"', '\\"'))); });
  if (stopped < 0) return [];
  const after = messages.slice(stopped + 1);
  const resumed = after.findIndex(isRunCall);
  if (resumed < 0) return [];
  let input: { resume?: unknown; args?: { resume?: unknown } } | null;
  try { input = JSON.parse(after[resumed]?.tool?.input ?? "{}"); } catch { return []; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const token = input.resume ?? input.args?.resume;
  if (typeof token !== "string" || (token !== run && !token.startsWith(`${run}.`))) return [];
  return burgerLayers(after.slice(0, resumed)).filter((layer) => layer.status === "done");
}

export function createStandaloneSkillBurgerRoutes(
  store: Pick<Store, "activePath" | "bots" | "bot" | "taskByThread">,
  sees: SkillBurgerRouteDeps["sees"],
  enabled: () => boolean,
  extras: Pick<SkillBurgerRouteDeps, "teammate" | "history"> = {},
): RouteHandler {
  return createSkillBurgerRoutes({
    ...extras,
    messages: (threadId) => store.activePath(threadId),
    botIds: () => store.bots.map((bot) => bot.id),
    assignedSkills: (botId) => store.bot(botId)?.assignedSkills,
    owns: (botId, threadId) => store.bot(botId)?.threadId === threadId || Boolean(store.taskByThread(botId, threadId)),
    sees,
    available: (auth) => auth.scopes.includes("admin") && enabled(),
  });
}

export function createSkillBurgerRoutes(deps: SkillBurgerRouteDeps): RouteHandler {
  const placeOf = (botId: string | null | undefined): BurgerPlace => (botId ? { botId } : { everyChat: true });
  const admin = (auth: RequestAuth) => auth.scopes.includes("admin");
  const level = (auth: RequestAuth, botId: string) => deps.levelOf ? deps.levelOf(auth, botId) : admin(auth) ? "edit" : "none";
  const refusal = (auth: RequestAuth, botId: string | null | undefined): string | null =>
    botId ? (level(auth, botId) === "edit" ? null : NOT_YOURS) : admin(auth) ? null : EVERY_CHAT_ADMIN_ONLY;
  const teammateFor = (auth: RequestAuth) => deps.teammate ? (name: string) => deps.teammate!(auth, name) : undefined;
  const drafted = (auth: RequestAuth, messages: readonly RunMessage[], summary?: string) => draftWorkflow(messages, { ...(summary ? { summary } : {}), ...(deps.teammate ? { teammate: teammateFor(auth) } : {}) });
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path === SKILL_BURGER_DRAFT_PATH) {
      if (deps.available && !deps.available(auth)) return json(res, 404, { error: "No such route." });
      // The card's view of the finished run: the same draft a save writes, so its step ids are the ones saved.
      if (method !== "POST") return json(res, 405, { error: "Use POST." });
      const body = summaryBody.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Send botId and threadId." });
      const { botId, threadId } = body.data;
      if (!deps.owns(botId, threadId) || !deps.sees(auth, threadId)) return json(res, 404, { error: "No such conversation." });
      const messages = deps.messages(threadId);
      const draft = drafted(auth, messages);
      return json(res, 200, { draft: draft ? draftView(draft.workflow, draft.layers, messages) : null });
    }
    if (path !== SKILL_BURGERS_PATH && !path.startsWith(`${SKILL_BURGERS_PATH}/`)) return PASS;
    if (deps.available && !deps.available(auth)) return json(res, 404, { error: "No such route." });
    const botIds = deps.botIds();
    if (path === SKILL_BURGERS_PATH) {
      if (method === "GET") {
        const visible = botIds.filter((botId) => level(auth, botId) !== "none");
        const skills = listWorkflowSkills(visible, deps.root).filter((skill) => admin(auth) || !skill.everyChat || visible.some((botId) => {
          const found = findWorkflowSkill(botId, skill.name, deps.root, deps.assignedSkills?.(botId));
          return found && "everyChat" in found.place;
        })).map((skill) => {
          if (!skill.everyChat || !skill.botId || level(auth, skill.botId) !== "none") return skill;
          const { botId: _hidden, ...rest } = skill;
          return rest;
        });
        return json(res, 200, { skills });
      }
      if (method !== "POST") return json(res, 405, { error: "Use GET or POST." });
      const body = saveBody.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Send botId and threadId." });
      if (deps.requiresShareConsent?.(auth) && !body.data.shareConsent) return json(res, 403, { error: "Confirm that this workflow may be shared with people who can see the bot." });
      let saved;
      if ("workflow" in body.data) {
        const { workflow, name, botId, everyChat } = body.data;
        if (!everyChat && (!botId || !botIds.includes(botId))) return json(res, 404, { error: "No such bot." });
        const refused = refusal(auth, everyChat ? null : botId);
        if (refused) return json(res, 403, { error: refused });
        saved = saveWorkflowSkill({ workflow, name, place: everyChat ? { everyChat: true } : { botId: botId! }, origin: botId, botIds, root: deps.root });
      } else {
        const { botId, threadId, summary, name, skip, inputs } = body.data;
        if (!deps.owns(botId, threadId) || !deps.sees(auth, threadId)) return json(res, 404, { error: "No such conversation." });
        const refused = refusal(auth, botId);
        if (refused) return json(res, 403, { error: refused });
        const draft = drafted(auth, deps.messages(threadId), summary);
        if (!draft) return json(res, 422, { error: "This run has nothing to save yet." });
        const chosen = applyChoices(draft.workflow, { ...(skip ? { skip } : {}), ...(inputs ? { inputs } : {}) });
        if ("error" in chosen) return json(res, 422, { error: chosen.error });
        saved = saveWorkflowSkill({ workflow: chosen, name, place: { botId }, botIds, root: deps.root });
      }
      if ("error" in saved) return json(res, saved.taken ? 409 : 422, { error: saved.error });
      return json(res, 201, { skill: saved });
    }
    const name = decodeURIComponent(path.slice(SKILL_BURGERS_PATH.length + 1));
    const stale = () => json(res, 409, { error: "This Skill Burger changed since. Reload and try again." });
    if (method === "POST" && name.endsWith("/fix")) {
      const body = fixBody.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Send the run and the step it fixed." });
      if (deps.requiresShareConsent?.(auth) && !body.data.shareConsent) return json(res, 403, { error: "Confirm that this change may be shared with people who can see the bot." });
      const { botId, runBotId, threadId, run, step } = body.data;
      const burger = name.slice(0, -"/fix".length);
      if (!deps.owns(runBotId, threadId) || !deps.sees(auth, threadId)) return json(res, 404, { error: "No such conversation." });
      const refused = refusal(auth, botId);
      if (refused) return json(res, 403, { error: refused });
      const found = readWorkflowSkill(placeOf(botId), burger, deps.root);
      const sha256 = listWorkflowSkills(botId ? [botId] : [], deps.root).find((skill) => skill.name === burger && skill.everyChat === !botId)?.sha256;
      if (!found || !sha256) return json(res, 404, { error: "No such skill." });
      const layers = fixLayers(deps.messages(threadId), run, step);
      if (!layers.length) return json(res, 422, { error: "The bot did nothing to fix it that could be saved." });
      const draft = draftFromLayers(layers, askOf(deps.messages(threadId)) ?? "", found.workflow.summary, deps.teammate ? { teammate: teammateFor(auth) } : {});
      const fix = mergeDraftInputs(found.workflow, draft);
      const next = insertFix(fix.workflow, step, fix.steps);
      if ("error" in next) return json(res, 422, next);
      const saved = replaceWorkflowSkill({ place: placeOf(botId), name: burger, workflow: next, sha256, root: deps.root });
      if ("stale" in saved) return stale();
      if ("error" in saved) return json(res, 422, saved);
      return json(res, 200, { skill: saved, undo: editUndo.keep(burger, found.workflow, saved.sha256, undoScope(placeOf(botId))) });
    }
    if (method === "POST" && name.endsWith("/paths")) {
      const body = pathBody.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Send the run, its decide step and the case." });
      if (deps.requiresShareConsent?.(auth) && !body.data.shareConsent) return json(res, 403, { error: "Confirm that this change may be shared with people who can see the bot." });
      const { botId, runBotId, threadId, run, decide, case: chosen } = body.data;
      const burger = name.slice(0, -"/paths".length);
      if (!deps.owns(runBotId, threadId) || !deps.sees(auth, threadId)) return json(res, 404, { error: "No such conversation." });
      const refused = refusal(auth, botId);
      if (refused) return json(res, 403, { error: refused });
      const found = readWorkflowSkill(placeOf(botId), burger, deps.root);
      const sha256 = listWorkflowSkills(botId ? [botId] : [], deps.root).find((skill) => skill.name === burger && skill.everyChat === !botId)?.sha256;
      if (!found || !sha256) return json(res, 404, { error: "No such skill." });
      const decision = found.workflow.steps.find((step) => step.id === decide && step.kind === "decide");
      if (!decision) return json(res, 422, { error: "No such decision step." });
      const uniqueLabel = found.workflow.steps.filter((step) => step.kind === "decide" && step.label === decision.label).length === 1;
      const layers = judgementLayers(deps.messages(threadId), run, decide, decision.label, chosen, uniqueLabel);
      if (!layers.length) return json(res, 422, { error: "The bot did nothing for this case that could be saved." });
      const draft = draftFromLayers(layers, askOf(deps.messages(threadId)) ?? "", found.workflow.summary, deps.teammate ? { teammate: teammateFor(auth) } : {});
      const addition = mergeDraftInputs(found.workflow, draft);
      const next = applyEdit(addition.workflow, { action: "add_case", decide: { id: decide }, case: chosen, steps: addition.steps });
      if ("error" in next) return json(res, 422, next);
      const saved = replaceWorkflowSkill({ place: placeOf(botId), name: burger, workflow: next, sha256, root: deps.root });
      if ("stale" in saved) return stale();
      if ("error" in saved) return json(res, 422, saved);
      return json(res, 200, { skill: saved, undo: editUndo.keep(burger, found.workflow, saved.sha256, undoScope(placeOf(botId))) });
    }
    if (method === "GET" && name.endsWith("/runs")) {
      // A burger's recent runs, by the bots this person can see.
      const burger = name.slice(0, -"/runs".length);
      const visible = new Set(botIds.filter((botId) => level(auth, botId) !== "none"));
      const runs = deps.history?.list(burger, visible).filter((run) => deps.sees(auth, run.threadId)) ?? [];
      return json(res, 200, { runs });
    }
    if (method === "GET") {
      const runner = url.searchParams.get("runner");
      if (runner) {
        if (level(auth, runner) === "none") return json(res, 404, { error: "No such skill." });
        const found = findWorkflowSkill(runner, name, deps.root, deps.assignedSkills?.(runner));
        return found ? json(res, 200, { workflow: found.workflow, everyChat: "everyChat" in found.place }) : json(res, 404, { error: "No such skill." });
      }
      const at = url.searchParams.get("botId");
      if (at && level(auth, at) === "none") return json(res, 404, { error: "No such skill." });
      if (!at && !admin(auth) && !botIds.some((botId) => {
        if (level(auth, botId) === "none") return false;
        const found = findWorkflowSkill(botId, name, deps.root, deps.assignedSkills?.(botId));
        return found && "everyChat" in found.place;
      })) return json(res, 404, { error: "No such skill." });
      const found = readWorkflowSkill(placeOf(at), name, deps.root);
      return found ? json(res, 200, found) : json(res, 404, { error: "No such skill." });
    }
    if (method === "PATCH") {
      const body = patchBody.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Send everyChat or rename." });
      if ("everyChat" in body.data && body.data.everyChat && deps.requiresShareConsent?.(auth) && !body.data.shareConsent) return json(res, 403, { error: "Confirm that this workflow may be shared with the whole team." });
      if ("everyChat" in body.data && body.data.everyChat && !body.data.botId) return json(res, 400, { error: "Send the source bot." });
      const refused = "everyChat" in body.data ? (!admin(auth) ? EVERY_CHAT_ADMIN_ONLY : body.data.everyChat ? refusal(auth, body.data.botId) : null) : refusal(auth, body.data.botId);
      if (refused) return json(res, 403, { error: refused });
      if ("everyChat" in body.data && !body.data.everyChat) {
        const origin = listWorkflowSkills([], deps.root).find((skill) => skill.everyChat && skill.name === name)?.botId;
        if (origin && level(auth, origin) !== "edit") return json(res, 403, { error: NOT_YOURS });
      }
      if ("undo" in body.data) {
        const kept = editUndo.take(body.data.undo, undoScope(placeOf(body.data.botId)), name);
        if (!kept) return json(res, 404, { error: "There is nothing to undo." });
        const restored = replaceWorkflowSkill({ place: placeOf(body.data.botId), name, workflow: kept.previous, sha256: kept.sha256, root: deps.root });
        if ("stale" in restored) return stale();
        return "error" in restored ? json(res, 422, { error: restored.error }) : json(res, 200, { skill: restored });
      }
      const result = "everyChat" in body.data
        ? setWorkflowEveryChat({ name, everyChat: body.data.everyChat, botIds: deps.botIds(), botId: body.data.botId, sha256: body.data.sha256, root: deps.root })
        : renameWorkflowSkill({ place: placeOf(body.data.botId), name, to: body.data.rename, botIds, sha256: body.data.sha256, root: deps.root });
      if ("stale" in result) return stale();
      if ("error" in result) return json(res, result.taken ? 409 : 422, { error: result.error });
      return json(res, 200, { skill: result });
    }
    if (method === "DELETE") {
      const refused = refusal(auth, url.searchParams.get("botId"));
      if (refused) return json(res, 403, { error: refused });
      const removed = removeWorkflowSkill(placeOf(url.searchParams.get("botId")), name, url.searchParams.get("sha256") ?? undefined, deps.root);
      if ("stale" in removed) return stale();
      if ("error" in removed) return json(res, 500, { error: removed.error });
      return json(res, 200, { removed: true });
    }
    return json(res, 405, { error: "Use GET, PATCH or DELETE." });
  };
}
