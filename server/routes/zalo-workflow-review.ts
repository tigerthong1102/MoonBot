import { listPrivateWorkflowSkills } from "../skill-burger/store.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Read only. The excerpt, its source label and any proposed actions stay in the owner's renderer. */
export function createZaloWorkflowReviewRoutes(localDesktop: boolean, list = listPrivateWorkflowSkills): RouteHandler {
  return async ({ path, method, auth, json, res }) => {
    const match = /^\/api\/zalo-workflow-review\/([a-zA-Z0-9_-]{1,128})$/.exec(path);
    if (!match) return PASS;
    res.setHeader("Cache-Control", "no-store");
    if (!localDesktop || auth.kind !== "loopback" || auth.desktopOwner !== true || auth.trust === "service" || auth.companionDevice) {
      return json(res, 403, { error: "desktop-owner-required" });
    }
    if (method !== "GET") return json(res, 405, { error: "method-not-allowed" });
    const botId = match[1]!;
    const workflows = list(botId).filter(skill => !skill.everyChat && skill.botId === botId)
      .map(({ name, summary, sha256, layers, args }) => ({ name, summary, sha256, steps: layers.map(layer => layer.label), inputs: args }));
    return json(res, 200, { workflows });
  };
}
