import type { IncomingMessage } from "node:http";
import { AI_TWIN_PATH } from "../../shared/ai-twin.ts";
import {
  createTwinInput, twinVersionInput, updateTwinInput, TwinConflict, type createAiTwinStore,
} from "../ai-twin.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createAiTwinRoutes(deps: {
  enabled: boolean;
  store: ReturnType<typeof createAiTwinStore>;
  owner: (req: IncomingMessage) => boolean;
  blocked: () => boolean;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== AI_TWIN_PATH) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const authorized = () => deps.enabled && auth.kind === "loopback" && auth.trust !== "service" && !auth.companionDevice && deps.owner(req);
    if (!authorized()) return json(res, 404, { error: "not_found" });
    try {
      if (method === "GET") return json(res, 200, deps.store.get());
      if (method !== "POST" && method !== "PATCH" && method !== "DELETE") {
        res.setHeader("allow", "GET, POST, PATCH, DELETE");
        return json(res, 405, { error: "method_not_allowed" });
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
        return json(res, 415, { error: "unsupported_media_type" });
      }
      const body = await readBody(req, 8_192);
      if (!authorized()) return json(res, 404, { error: "not_found" });
      if (deps.blocked()) return json(res, 409, { error: "twin_workspace_busy" });
      if (method === "POST") {
        const input = createTwinInput.safeParse(body);
        if (!input.success) return json(res, 400, { error: "invalid_twin" });
        const result = deps.store.create(input.data);
        return json(res, result.created ? 201 : 200, result.view);
      }
      if (method === "PATCH") {
        const input = updateTwinInput.safeParse(body);
        if (!input.success) return json(res, 400, { error: "invalid_twin" });
        return json(res, 200, deps.store.update(input.data));
      }
      const input = twinVersionInput.safeParse(body);
      if (!input.success) return json(res, 400, { error: "invalid_twin" });
      return json(res, 200, deps.store.delete(input.data));
    } catch (error) {
      if (error instanceof TwinConflict) return json(res, 409, { error: "twin_changed" });
      const status = (error as { status?: unknown })?.status;
      if (status === 400 || status === 413) return json(res, status, { error: "invalid_twin" });
      return json(res, 503, { error: "twin_store_unavailable" });
    }
  };
}
