import { z } from "zod";

import { draftFromLayers, draftWorkflow } from "../../shared/skill-burger/draft.ts";
import { askOf, burgerLayers, type RunMessage } from "../../shared/skill-burger/layers.ts";
import { caseName } from "../../shared/skill-burger/format.ts";
import { applyEdit, editUndo } from "./edit.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { findWorkflowSkill, listWorkflowSkills, readWorkflowSkill, removeWorkflowSkill, renameWorkflowSkill, replaceWorkflowSkill, saveWorkflowSkill, setWorkflowEveryChat, type BurgerPlace } from "./store.ts";
import type { Store } from "../store.ts";

export const SKILL_BURGERS_PATH = "/api/skill-burgers";

export interface SkillBurgerRouteDeps {
  available?(auth: RequestAuth): boolean;
  messages(threadId: string): readonly RunMessage[];
  owns(botId: string, threadId: string): boolean;
  sees(auth: RequestAuth, threadId: string): boolean;
  botIds(): readonly string[];
  levelOf?(auth: RequestAuth, botId: string): "none" | "view" | "chat" | "edit";
  root?: string;
}

/** A burger used in every chat belongs to the whole place: only an admin turns that on, renames or removes one. */
export const EVERY_CHAT_ADMIN_ONLY = "Only an admin of this installation can change this.";
const NOT_YOURS = "Only people who can edit this bot can change its Skill Burgers.";

const id = z.string().min(1).max(100);
const saveBody = z.union([
  z.object({ botId: id, threadId: z.string().min(1).max(200), summary: z.string().max(160).optional(), name: z.string().max(64).optional() }).strict(),
  z.object({ workflow: z.unknown(), name: z.string().max(64), botId: id.optional(), everyChat: z.boolean().optional() }).strict(),
]);
const patchBody = z.union([
  z.object({ everyChat: z.boolean(), botId: id.optional(), sha256: z.string().max(64).optional() }).strict(),
  z.object({ rename: z.string().min(1).max(64), botId: id.optional(), sha256: z.string().max(64).optional() }).strict(),
  // Undo of a change to the steps: the id that change returned.
  z.object({ undo: z.string().min(1).max(64), botId: id.optional() }).strict(),
]);
/** One tap's "Add the path": the steps the bot did by judgement for a case nobody had saved, after the run handed it over. */
const pathBody = z.object({ botId: id.optional(), runBotId: id, threadId: z.string().min(1).max(200), run: z.string().min(1).max(64), decide: z.string().min(1).max(40), case: caseName }).strict();

/** The tool rows of the bot's own steps between the run handing over `run` and the run going on: what it did by judgement. */
export function judgementLayers(messages: readonly RunMessage[], run: string) {
  const isRunCall = (message: RunMessage) => message.kind === "activity" && /(?:^|__)run_workflow$/.test(message.tool?.name ?? "");
  const handed = messages.findIndex((message) => isRunCall(message) && (message.tool?.output ?? "").includes(run));
  if (handed < 0) return [];
  const after = messages.slice(handed + 1);
  const resumed = after.findIndex(isRunCall);
  return burgerLayers(resumed < 0 ? after : after.slice(0, resumed)).filter((layer) => layer.status === "done");
}

export function createStandaloneSkillBurgerRoutes(
  store: Pick<Store, "activePath" | "bots" | "bot" | "taskByThread">,
  sees: SkillBurgerRouteDeps["sees"],
  enabled: () => boolean,
): RouteHandler {
  return createSkillBurgerRoutes({
    messages: (threadId) => store.activePath(threadId),
    botIds: () => store.bots.map((bot) => bot.id),
    owns: (botId, threadId) => store.bot(botId)?.threadId === threadId || Boolean(store.taskByThread(botId, threadId)),
    sees,
    available: (auth) => auth.scopes.includes("admin") && enabled(),
  });
}

export function createSkillBurgerRoutes(deps: SkillBurgerRouteDeps): RouteHandler {
  const placeOf = (botId: string | null | undefined): BurgerPlace => (botId ? { botId } : { everyChat: true });
  const admin = (auth: RequestAuth) => auth.scopes.includes("admin");
  const level = (auth: RequestAuth, botId: string) => (admin(auth) ? "edit" : deps.levelOf?.(auth, botId) ?? "none");
  const refusal = (auth: RequestAuth, botId: string | null | undefined): string | null =>
    botId ? (level(auth, botId) === "edit" ? null : NOT_YOURS) : admin(auth) ? null : EVERY_CHAT_ADMIN_ONLY;
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (path !== SKILL_BURGERS_PATH && !path.startsWith(`${SKILL_BURGERS_PATH}/`)) return PASS;
    if (deps.available && !deps.available(auth)) return json(res, 404, { error: "No such route." });
    const botIds = deps.botIds();
    if (path === SKILL_BURGERS_PATH) {
      if (method === "GET") {
        const visible = admin(auth) ? botIds : botIds.filter((botId) => level(auth, botId) !== "none");
        return json(res, 200, { skills: listWorkflowSkills(visible, deps.root) });
      }
      if (method !== "POST") return json(res, 405, { error: "Use GET or POST." });
      const body = saveBody.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Send botId and threadId." });
      let saved;
      if ("workflow" in body.data) {
        const { workflow, name, botId, everyChat } = body.data;
        if (!everyChat && (!botId || !botIds.includes(botId))) return json(res, 404, { error: "No such bot." });
        const refused = refusal(auth, everyChat ? null : botId);
        if (refused) return json(res, 403, { error: refused });
        saved = saveWorkflowSkill({ workflow, name, place: everyChat ? { everyChat: true } : { botId: botId! }, origin: botId, botIds, root: deps.root });
      } else {
        const { botId, threadId, summary, name } = body.data;
        if (!deps.owns(botId, threadId) || !deps.sees(auth, threadId)) return json(res, 404, { error: "No such conversation." });
        const refused = refusal(auth, botId);
        if (refused) return json(res, 403, { error: refused });
        const draft = draftWorkflow(deps.messages(threadId), { summary });
        if (!draft) return json(res, 422, { error: "This run has nothing to save yet." });
        const workflow = draft.workflow;
        saved = saveWorkflowSkill({ workflow, name, place: { botId }, botIds, root: deps.root });
      }
      if ("error" in saved) return json(res, saved.taken ? 409 : 422, { error: saved.error });
      return json(res, 201, { skill: saved });
    }
    const name = decodeURIComponent(path.slice(SKILL_BURGERS_PATH.length + 1));
    const stale = () => json(res, 409, { error: "This Skill Burger changed since. Reload and try again." });
    if (method === "POST" && name.endsWith("/paths")) {
      const body = pathBody.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Send the run, its decide step and the case." });
      const { botId, runBotId, threadId, run, decide, case: chosen } = body.data;
      const burger = name.slice(0, -"/paths".length);
      if (!deps.owns(runBotId, threadId) || !deps.sees(auth, threadId)) return json(res, 404, { error: "No such conversation." });
      const refused = refusal(auth, botId);
      if (refused) return json(res, 403, { error: refused });
      const found = readWorkflowSkill(placeOf(botId), burger, deps.root);
      const sha256 = listWorkflowSkills(botId ? [botId] : [], deps.root).find((skill) => skill.name === burger && skill.everyChat === !botId)?.sha256;
      if (!found || !sha256) return json(res, 404, { error: "No such skill." });
      const layers = judgementLayers(deps.messages(threadId), run);
      if (!layers.length) return json(res, 422, { error: "The bot did nothing for this case that could be saved." });
      const steps = draftFromLayers(layers, askOf(deps.messages(threadId)) ?? "", found.workflow.summary).steps;
      const next = applyEdit(found.workflow, { action: "add_case", decide: { id: decide }, case: chosen, steps });
      if ("error" in next) return json(res, 422, next);
      const saved = replaceWorkflowSkill({ place: placeOf(botId), name: burger, workflow: next, sha256, root: deps.root });
      if ("stale" in saved) return stale();
      if ("error" in saved) return json(res, 422, saved);
      return json(res, 200, { skill: saved, undo: editUndo.keep(burger, found.workflow, saved.sha256) });
    }
    if (method === "GET") {
      const runner = url.searchParams.get("runner");
      if (runner) {
        if (level(auth, runner) === "none") return json(res, 404, { error: "No such skill." });
        const found = findWorkflowSkill(runner, name, deps.root);
        return found ? json(res, 200, { workflow: found.workflow, everyChat: "everyChat" in found.place }) : json(res, 404, { error: "No such skill." });
      }
      const at = url.searchParams.get("botId");
      if (at && level(auth, at) === "none") return json(res, 404, { error: "No such skill." });
      const found = readWorkflowSkill(placeOf(at), name, deps.root);
      return found ? json(res, 200, found) : json(res, 404, { error: "No such skill." });
    }
    if (method === "PATCH") {
      const body = patchBody.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Send everyChat or rename." });
      const refused = "everyChat" in body.data ? (admin(auth) ? null : EVERY_CHAT_ADMIN_ONLY) : refusal(auth, body.data.botId);
      if (refused) return json(res, 403, { error: refused });
      if ("undo" in body.data) {
        const kept = editUndo.take(body.data.undo);
        if (!kept || kept.name !== name) return json(res, 404, { error: "There is nothing to undo." });
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
