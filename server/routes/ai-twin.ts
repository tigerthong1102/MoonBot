import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { AI_TWIN_PATH, AI_TWIN_PREVIEW_PATH, AI_TWIN_QUESTION_MAX, type AiTwinView } from "../../shared/ai-twin.ts";
import { createTwinInput, twinVersionInput, updateTwinInput, TwinConflict, type createAiTwinStore } from "../ai-twin.ts";
import { TwinPreviewError, type createAiTwinPreview } from "../ai-twin-preview.ts";
import { PASS, type RouteHandler } from "./table.ts";

const previewInput = twinVersionInput.extend({
  question: z.string().trim().min(1).max(AI_TWIN_QUESTION_MAX),
  key: z.uuid(),
  useProvider: z.literal(true),
});

export function createAiTwinRoutes(deps: {
  enabled: boolean;
  store: ReturnType<typeof createAiTwinStore>;
  preview: ReturnType<typeof createAiTwinPreview>;
  owner: (req: IncomingMessage) => boolean;
  blocked: () => boolean;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const preview = path === AI_TWIN_PREVIEW_PATH;
    if (path !== AI_TWIN_PATH && !preview) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const authorized = () => deps.enabled && auth.kind === "loopback" && auth.trust !== "service" && !auth.companionDevice && deps.owner(req);
    if (!authorized()) return json(res, 404, { error: "not_found" });

    function replyProfile(status: number, view: AiTwinView) {
      const provider = view.twin && !view.twin.paused ? deps.preview.provider(view.twin.id) : null;
      return json(res, status, provider ? { ...view, preview: provider } : view);
    }

    try {
      if (method === "GET" && !preview) return replyProfile(200, deps.store.get());
      const allowed = preview ? method === "POST" : method === "POST" || method === "PATCH" || method === "DELETE";
      if (!allowed) {
        res.setHeader("allow", preview ? "POST" : "GET, POST, PATCH, DELETE");
        return json(res, 405, { error: "method_not_allowed" });
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
        return json(res, 415, { error: "unsupported_media_type" });
      }
      const body = await readBody(req, 8_192);
      if (!authorized()) return json(res, 404, { error: "not_found" });
      if (deps.blocked()) return json(res, 409, { error: "twin_workspace_busy" });
      if (preview) {
        const input = previewInput.safeParse(body);
        if (!input.success) return json(res, 400, { error: "invalid_twin" });
        const twin = deps.store.get().twin;
        if (!twin || twin.paused || input.data.id !== twin.id || input.data.revision !== twin.revision) {
          return json(res, 409, { error: "twin_changed" });
        }
        const disconnected = new AbortController();
        const close = () => disconnected.abort();
        res.once("close", close);
        try {
          const draft = await deps.preview.draft(twin, input.data.question, input.data.key, disconnected.signal);
          if (!authorized()) return json(res, 404, { error: "not_found" });
          const current = deps.store.get().twin;
          if (deps.blocked() || current?.revision !== twin.revision || current.id !== twin.id) {
            return json(res, 409, { error: "twin_changed" });
          }
          return json(res, 200, { draft });
        } catch (error) {
          if (disconnected.signal.aborted) return;
          const code = error instanceof TwinPreviewError ? error.code : "twin_preview_unavailable";
          return json(res, code === "twin_preview_unavailable" ? 503 : 409, { error: code });
        } finally {
          res.off("close", close);
        }
      }
      if (method === "POST") {
        const input = createTwinInput.safeParse(body);
        if (!input.success) return json(res, 400, { error: "invalid_twin" });
        const result = deps.store.create(input.data);
        return replyProfile(result.created ? 201 : 200, result.view);
      }
      if (method === "PATCH") {
        const input = updateTwinInput.safeParse(body);
        if (!input.success) return json(res, 400, { error: "invalid_twin" });
        const view = deps.store.update(input.data);
        deps.preview.cancel();
        return replyProfile(200, view);
      }
      const input = twinVersionInput.safeParse(body);
      if (!input.success) return json(res, 400, { error: "invalid_twin" });
      const deleted = deps.store.delete(input.data);
      deps.preview.cancel();
      return replyProfile(200, deleted);
    } catch (error) {
      if (error instanceof TwinConflict) return json(res, 409, { error: "twin_changed" });
      const status = (error as { status?: unknown })?.status;
      if (status === 400 || status === 413) return json(res, status, { error: "invalid_twin" });
      return json(res, 503, { error: "twin_store_unavailable" });
    }
  };
}
