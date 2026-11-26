import { z } from "zod";
import { AI_TWIN_PATH, AI_TWIN_PREVIEW_PATH, AI_TWIN_LESSONS_PATH, AI_TWIN_LOOKUP_PATH, AI_TWIN_QUESTION_MAX, type AiTwinView } from "../../shared/ai-twin.ts";
import {
  createTwinInput, deleteTwinLessonInput, lookupTwinLessonInput, saveTwinLessonInput,
  twinVersionInput, updateTwinInput, createAiTwinStore, TwinConflict, TwinLessonConflict,
} from "../ai-twin.ts";
import { createAiTwinPreview, TwinPreviewError } from "../ai-twin-preview.ts";
import { hasDesktopOwnerCapability } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const previewInput = twinVersionInput.extend({
  question: z.string().trim().min(1).max(AI_TWIN_QUESTION_MAX),
  key: z.uuid(),
  useProvider: z.literal(true),
});

export function createAiTwinRoutes(deps: {
  enabled: boolean;
  dataDir: string;
  workspace: string;
  preview: Parameters<typeof createAiTwinPreview>[0];
  ownerToken: () => string | undefined;
  blocked: () => boolean;
}): RouteHandler {
  const store = createAiTwinStore(deps.dataDir, deps.workspace);
  const drafts = createAiTwinPreview(deps.preview);
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const preview = path === AI_TWIN_PREVIEW_PATH;
    const teaching = path === AI_TWIN_LESSONS_PATH;
    const lookup = path === AI_TWIN_LOOKUP_PATH;
    if (path !== AI_TWIN_PATH && !preview && !teaching && !lookup) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const authorized = () => deps.enabled && auth.kind === "loopback" && auth.trust !== "service"
      && !auth.companionDevice && hasDesktopOwnerCapability(req, deps.ownerToken());
    if (!authorized()) return json(res, 404, { error: "not_found" });

    function replyProfile(status: number, view: AiTwinView) {
      const provider = view.twin && !view.twin.paused ? drafts.provider(view.twin.id) : null;
      return json(res, status, provider ? { ...view, preview: provider } : view);
    }

    try {
      if (method === "GET" && path === AI_TWIN_PATH) return replyProfile(200, store.get());
      const allowed = preview || lookup ? ["POST"] : teaching ? ["POST", "DELETE"] : ["GET", "POST", "PATCH", "DELETE"];
      if (!allowed.includes(method)) {
        res.setHeader("allow", allowed.join(", "));
        return json(res, 405, { error: "method_not_allowed" });
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
        return json(res, 415, { error: "unsupported_media_type" });
      }
      const body = await readBody(req, 8_192);
      if (!authorized()) return json(res, 404, { error: "not_found" });
      if (deps.blocked()) return json(res, 409, { error: "twin_workspace_busy" });
      if (teaching) {
        const next = method === "POST" ? saveTwinLessonInput.safeParse(body) : deleteTwinLessonInput.safeParse(body);
        if (!next.success) return json(res, 400, { error: "invalid_twin" });
        const view = "saveAsLesson" in next.data ? store.saveLesson(next.data) : store.forgetLesson(next.data);
        drafts.cancel();
        return replyProfile(200, view);
      }
      if (lookup) {
        const input = lookupTwinLessonInput.safeParse(body);
        if (!input.success) return json(res, 400, { error: "invalid_twin" });
        return json(res, 200, { lesson: store.lookupLesson(input.data) });
      }
      if (preview) {
        const input = previewInput.safeParse(body);
        if (!input.success) return json(res, 400, { error: "invalid_twin" });
        const twin = store.get().twin;
        if (!twin || twin.paused || input.data.id !== twin.id || input.data.revision !== twin.revision) {
          return json(res, 409, { error: "twin_changed" });
        }
        const disconnected = new AbortController();
        const close = () => disconnected.abort();
        res.once("close", close);
        try {
          const draft = await drafts.draft(twin, input.data.question, input.data.key, disconnected.signal);
          if (!authorized()) return json(res, 404, { error: "not_found" });
          const current = store.get().twin;
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
        const result = store.create(input.data);
        return replyProfile(result.created ? 201 : 200, result.view);
      }
      if (method === "PATCH") {
        const input = updateTwinInput.safeParse(body);
        if (!input.success) return json(res, 400, { error: "invalid_twin" });
        const view = store.update(input.data);
        drafts.cancel();
        return replyProfile(200, view);
      }
      const input = twinVersionInput.safeParse(body);
      if (!input.success) return json(res, 400, { error: "invalid_twin" });
      const deleted = store.delete(input.data);
      drafts.cancel();
      return replyProfile(200, deleted);
    } catch (error) {
      if (error instanceof TwinConflict) return json(res, 409, { error: "twin_changed" });
      if (error instanceof TwinLessonConflict) return json(res, error.code === "twin_lesson_empty" ? 400 : 409, { error: error.code });
      const status = (error as { status?: unknown })?.status;
      if (status === 400 || status === 413) return json(res, status, { error: "invalid_twin" });
      return json(res, 503, { error: "twin_store_unavailable" });
    }
  };
}
