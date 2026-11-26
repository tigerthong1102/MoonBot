import type { IncomingMessage } from "node:http";
import { z } from "zod";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { SkillBurgerRuns } from "./runs.ts";

const decisionBody = z.object({
  token: z.string().regex(/^[0-9a-f-]{36}\.[0-9a-f-]{36}$/),
  decision: z.enum(["allow", "deny"]),
}).strict();

export function workflowApprovalRoutes(deps: {
  approvals: SkillBurgerRuns["approvals"];
  sees(auth: RequestAuth, botId: string, threadId: string): boolean;
  roomEditors(auth: RequestAuth, groupId: string, threadId: string): readonly string[] | null;
  human(auth: RequestAuth, req: IncomingMessage): boolean;
}): RouteHandler {
  return async ({ path, method, req, res, auth, url, readBody, json }) => {
    const match = /^\/api\/(bots|groups)\/([\w-]+)\/workflow-approvals$/.exec(path);
    if (!match) return PASS;
    const [, owner, ownerId] = match;
    const threadId = url.searchParams.get("threadId") ?? "";
    res.setHeader("cache-control", "private, no-store");
    if (owner === "groups") {
      if (method !== "GET") return json(res, 405, { error: "Use GET." });
      const editors = deps.roomEditors(auth, ownerId!, threadId);
      if (!editors?.length) return json(res, 404, { error: "No such conversation." });
      return json(res, 200, { waits: deps.approvals.listRoom(threadId, editors) });
    }
    const botId = ownerId!;
    if (!threadId || !deps.sees(auth, botId, threadId)) return json(res, 404, { error: "No such conversation." });
    if (method === "GET") return json(res, 200, { waits: deps.approvals.list(botId, threadId) });
    if (method !== "POST") return json(res, 405, { error: "Use GET or POST." });
    const input = decisionBody.safeParse(await readBody(req, 2048));
    if (!input.success) return json(res, 400, { error: "A current pause and a decision are required." });
    if (!deps.sees(auth, botId, threadId)) return json(res, 404, { error: "No such conversation." });
    if (!deps.human(auth, req)) return json(res, 403, { error: "Use an authorized signed-in device, or the local browser after the bots are idle." });
    const ok = deps.approvals.decide(input.data.token, botId, threadId, input.data.decision);
    return ok ? json(res, 200, { ok: true }) : json(res, 409, { error: "This pause expired, changed or was already answered." });
  };
}
