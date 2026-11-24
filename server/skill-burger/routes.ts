import { z } from "zod";

import { draftWorkflow } from "../../shared/skill-burger/draft.ts";
import type { RunMessage } from "../../shared/skill-burger/layers.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { Store } from "../store.ts";
import { listWorkflowSkills, readWorkflowSkill, removeWorkflowSkill, renameWorkflowSkill, saveWorkflowSkill, setWorkflowEveryChat, type BurgerPlace } from "./store.ts";

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
]);

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
        saved = saveWorkflowSkill({ workflow: draft.workflow, name, place: { botId }, botIds, root: deps.root });
      }
      if ("error" in saved) return json(res, saved.taken ? 409 : 422, { error: saved.error });
      return json(res, 201, { skill: saved });
    }
    const name = decodeURIComponent(path.slice(SKILL_BURGERS_PATH.length + 1));
    const stale = () => json(res, 409, { error: "This Skill Burger changed since. Reload and try again." });
    if (method === "GET") {
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
      const result = "everyChat" in body.data
        ? setWorkflowEveryChat({ name, everyChat: body.data.everyChat, botId: body.data.botId, sha256: body.data.sha256, root: deps.root })
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
