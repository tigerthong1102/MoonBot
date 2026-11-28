import { z } from "zod";
import {
  AI_TWIN_DELEGATION_PATH, AI_TWIN_LEARNING_PATH, AI_TWIN_LESSONS_PATH, AI_TWIN_LOOKUP_PATH,
  AI_TWIN_PATH, AI_TWIN_PHONE_PATH, AI_TWIN_PREVIEW_PATH, AI_TWIN_QUESTION_MAX,
  type AiTwinLearningView, type AiTwinView,
} from "../../shared/ai-twin.ts";
import {
  createTwinInput, deleteTwinLessonInput, lookupTwinLessonInput, saveTwinLessonInput, twinDelegationInput,
  twinLearningInput, twinPhoneInput, twinVersionInput, updateTwinInput, createAiTwinStore, TwinConflict, TwinLessonConflict,
} from "../ai-twin.ts";
import { createAiTwinPreview, TwinPreviewError } from "../ai-twin-preview.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const providerFields = { key: z.uuid(), useProvider: z.literal(true) };
const previewInput = twinVersionInput.extend({
  question: z.string().trim().min(1).max(AI_TWIN_QUESTION_MAX),
  ...providerFields,
  useMemory: z.literal(true).optional(),
});
const semanticInput = lookupTwinLessonInput.extend(providerFields);
const paths = new Map([
  [AI_TWIN_PATH, ["GET", "POST", "PATCH", "DELETE"]],
  [AI_TWIN_LOOKUP_PATH, ["POST"]],
  [AI_TWIN_PREVIEW_PATH, ["POST"]],
  [AI_TWIN_LESSONS_PATH, ["POST", "DELETE"]],
  [AI_TWIN_LEARNING_PATH, ["GET", "PATCH"]],
  [AI_TWIN_DELEGATION_PATH, ["PATCH"]],
  [AI_TWIN_PHONE_PATH, ["PATCH"]],
]);

export function createAiTwinRoutes(deps: {
  store: ReturnType<typeof createAiTwinStore>;
  preview: Parameters<typeof createAiTwinPreview>[0];
  owner: (auth: RequestAuth) => boolean;
  phone: (auth: RequestAuth) => boolean;
  canEnablePhone: boolean;
  learning: (auth: RequestAuth, sources: readonly string[]) => AiTwinLearningView;
  learnedStyle: (auth: RequestAuth, sources: readonly string[]) => AiTwinLearningView["style"];
  blocked: () => boolean;
}): RouteHandler {
  const { store } = deps;
  const drafts = createAiTwinPreview(deps.preview);
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const allowed = paths.get(path);
    if (!allowed) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const phone = deps.phone(auth) && ((path === AI_TWIN_PATH && method === "GET") ||
      ((path === AI_TWIN_LOOKUP_PATH || path === AI_TWIN_PREVIEW_PATH) && method === "POST"));
    const owner = deps.owner(auth);
    if (!owner && !phone) return json(res, 404, { error: "not_found" });
    const authorized = () => deps.owner(auth) || (phone && store.get().controls?.phone === true && deps.phone(auth));

    function replyProfile(status: number, view: AiTwinView) {
      const provider = view.twin && !view.twin.paused ? drafts.provider(view.twin.id) : null;
      if (!owner) return json(res, status, {
        twin: view.twin && { ...view.twin, style: "" }, creationEpoch: view.creationEpoch,
        ...(provider ? { preview: provider } : {}),
      });
      return json(res, status, {
        ...view, ...(provider ? { preview: provider } : {}),
        ...(deps.canEnablePhone ? { canEnablePhone: true } : {}),
      });
    }

    try {
      if (!authorized()) return json(res, 404, { error: "not_found" });
      if (method === "GET" && path === AI_TWIN_PATH) return replyProfile(200, store.get());
      if (method === "GET" && path === AI_TWIN_LEARNING_PATH) {
        const view = store.get();
        return json(res, 200, deps.learning(auth, view.twin?.paused ? [] : view.controls?.sourceIds ?? []));
      }
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
      if (path === AI_TWIN_LESSONS_PATH) {
        const next = method === "POST" ? saveTwinLessonInput.safeParse(body) : deleteTwinLessonInput.safeParse(body);
        if (!next.success) return json(res, 400, { error: "invalid_twin" });
        if ("saveAsLesson" in next.data && next.data.example) {
          const { thread, message } = next.data.example;
          const current = store.get();
          if (!current.twin || current.twin.paused || !current.controls?.sourceIds.includes(thread) ||
              !deps.learning(auth, [thread]).examples.some((example) => example.message === message)) {
            throw new TwinConflict();
          }
        }
        const view = "saveAsLesson" in next.data ? store.saveLesson(next.data) : store.forgetLesson(next.data);
        drafts.cancel();
        return replyProfile(200, view);
      }
      if (path === AI_TWIN_LEARNING_PATH || path === AI_TWIN_DELEGATION_PATH || path === AI_TWIN_PHONE_PATH) {
        const learning = path === AI_TWIN_LEARNING_PATH ? twinLearningInput.safeParse(body) : undefined;
        const delegation = path === AI_TWIN_DELEGATION_PATH ? twinDelegationInput.safeParse(body) : undefined;
        const mobile = path === AI_TWIN_PHONE_PATH ? twinPhoneInput.safeParse(body) : undefined;
        let view: AiTwinView;
        if (learning?.success && (!learning.data.enabled || deps.learning(auth, []).conversations.some(({ id }) => id === learning.data.thread))) {
          view = store.setLearning(learning.data);
        } else if (delegation?.success && (!delegation.data.enabled || deps.learning(auth, []).rooms.some(({ id }) => id === delegation.data.room))) {
          view = store.setDelegation(delegation.data);
        } else if (mobile?.success && deps.canEnablePhone) {
          view = store.setPhone(mobile.data);
        } else {
          return json(res, 400, { error: "invalid_twin" });
        }
        drafts.cancel();
        return replyProfile(200, view);
      }
      if (path === AI_TWIN_LOOKUP_PATH || path === AI_TWIN_PREVIEW_PATH) {
        const isLookup = path === AI_TWIN_LOOKUP_PATH;
        const exact = isLookup ? lookupTwinLessonInput.safeParse(body) : null;
        if (exact?.success) return json(res, 200, { lesson: store.lookupLesson(exact.data) });

        const input = (isLookup ? semanticInput : previewInput).safeParse(body);
        if (!input.success) return json(res, 400, { error: "invalid_twin" });
        const { id, revision, question, key } = input.data;
        const current = store.get();
        const twin = current.twin;
        if (!twin || twin.paused || id !== twin.id || revision !== twin.revision) throw new TwinConflict();
        const useMemory = isLookup || ("useMemory" in input.data && input.data.useMemory === true);
        const disconnected = new AbortController();
        const close = () => disconnected.abort();
        res.once("close", close);
        function assertCurrent() {
          if (!authorized() || deps.blocked()) throw new TwinConflict();
          const latest = store.get().twin;
          if (latest?.revision !== revision || latest.id !== id) throw new TwinConflict();
        }
        try {
          const exactMatch = useMemory ? store.lookupLesson({ id, revision, question }) : null;
          const allowedLessons = current.lessons?.filter((entry) => entry.allowProvider) ?? [];
          const lesson = exactMatch ? (isLookup || exactMatch.allowProvider ? exactMatch : null)
            : useMemory ? await drafts.recall(twin, question, allowedLessons, key, disconnected.signal, assertCurrent) : null;
          assertCurrent();
          if (isLookup) return json(res, 200, { lesson, ...(lesson && !exactMatch ? { match: "semantic" } : {}) });

          const style = useMemory ? deps.learnedStyle(auth, current.controls?.sourceIds ?? []) : undefined;
          const draft = await drafts.draft(twin, question, key, disconnected.signal, { lesson, style });
          assertCurrent();
          if (style && JSON.stringify(style) !== JSON.stringify(deps.learnedStyle(auth, current.controls?.sourceIds ?? []))) {
            throw new TwinConflict();
          }
          return json(res, 200, { draft, ...(lesson ? { lesson, match: exactMatch ? "exact" : "semantic" } : {}) });
        } catch (error) {
          if (disconnected.signal.aborted) return;
          if (error instanceof TwinConflict) throw error;
          assertCurrent();
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
