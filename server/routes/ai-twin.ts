import { ZALO_OWNER_STYLE_PATH } from "../../shared/zalo-owner-style.ts";
import { ZALO_RECIPES, type ZaloRecipe } from "../../shared/zalo-intelligence.ts";
import type { TwinExampleSource } from "../ai-twin-lesson-sources.ts";
import { z } from "zod";
import { holdsCredential, redactSecretsInText } from "../../shared/redact.ts";
import {
  AI_TWIN_DELEGATION_PATH, AI_TWIN_LEARNING_PATH, AI_TWIN_LESSONS_PATH, AI_TWIN_LOOKUP_PATH,
  AI_TWIN_PATH, AI_TWIN_PHONE_PATH, AI_TWIN_PREVIEW_PATH, AI_TWIN_QUESTION_MAX,
  AI_TWIN_FORGET_MANY_PATH,
  type AiTwinLearningView, type AiTwinView,
} from "../../shared/ai-twin.ts";
import {
  createTwinInput, deleteTwinLessonInput, forgetTwinLessonsInput, lookupTwinLessonInput, saveTwinLessonInput, twinDelegationInput,
  twinLearningInput, twinPhoneInput, twinVersionInput, updateTwinInput, createAiTwinStore, TwinConflict, TwinLessonConflict,
} from "../ai-twin.ts";
import { twinLessonKey } from "../ai-twin-lessons.ts";
import { createAiTwinPreview, TwinPreviewError } from "../ai-twin-preview.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createOwnerStyleRoutes, ownerStyleAllowed } from "./ai-twin-owner-style.ts";
import { PASS, type RouteHandler } from "./table.ts";

const providerFields = { key: z.uuid(), useProvider: z.literal(true) };
const previewInput = twinVersionInput.extend({
  question: z.string().trim().min(1).max(AI_TWIN_QUESTION_MAX),
  ...providerFields,
  useMemory: z.literal(true).optional(),
  zaloEvidence: z.strictObject({ citation: z.string().trim().min(1).max(180), quote: z.string().trim().min(1).max(1000) }).optional(),
  zaloRecipe: z.enum(ZALO_RECIPES).optional(),
  zaloSource: z.strictObject({ source: z.string().trim().min(1).max(120), line: z.int().min(1).max(5_000) }).optional(),
});
const semanticInput = lookupTwinLessonInput.extend({ ...providerFields, zaloEvidence: z.never().optional(), zaloRecipe: z.never().optional(), zaloSource: z.never().optional() });
const exactLessonsPath = AI_TWIN_PATH + "/inbox-exact-lessons";
const paths = new Map([
  [exactLessonsPath, ["GET"]],
  [AI_TWIN_PATH, ["GET", "POST", "PATCH", "DELETE"]],
  [AI_TWIN_LOOKUP_PATH, ["POST"]],
  [AI_TWIN_PREVIEW_PATH, ["POST"]],
  [AI_TWIN_LESSONS_PATH, ["POST", "DELETE"]],
  [AI_TWIN_FORGET_MANY_PATH, ["DELETE"]],
  [AI_TWIN_LEARNING_PATH, ["GET", "PATCH"]],
  [AI_TWIN_DELEGATION_PATH, ["PATCH"]],
  [AI_TWIN_PHONE_PATH, ["PATCH"]],
]);

function uniqueLessons(lessons: NonNullable<AiTwinView["lessons"]>) {
  const seen = new Set<string>(), ambiguous = new Set<string>();
  for (const lesson of lessons) {
    const key = twinLessonKey(lesson.question);
    if (seen.has(key)) ambiguous.add(key);
    seen.add(key);
  }
  return lessons.filter(lesson => !ambiguous.has(twinLessonKey(lesson.question)));
}

export function createAiTwinRoutes(deps: {
  store: ReturnType<typeof createAiTwinStore>;
  storeFor: (auth: RequestAuth) => ReturnType<typeof createAiTwinStore>;
  source: (auth: RequestAuth, thread: string, message: string) => TwinExampleSource | undefined;
  preview: Parameters<typeof createAiTwinPreview>[0];
  zaloRecipe?: (id: ZaloRecipe) => string | undefined;
  owner: (auth: RequestAuth) => boolean;
  phone: (auth: RequestAuth) => boolean;
  canEnablePhone: boolean;
  desktop?: boolean;
  learning: (auth: RequestAuth, sources: readonly string[]) => AiTwinLearningView;
  learnedStyle: (auth: RequestAuth, sources: readonly string[]) => AiTwinLearningView["style"];
  blocked: () => boolean;
}): RouteHandler {
  const drafts = createAiTwinPreview(deps.preview);
  const ownerStyle = createOwnerStyleRoutes({ store: deps.store, owner: auth => deps.desktop === true && deps.owner(auth), blocked: deps.blocked, cancelDrafts: () => drafts.cancel() });
  return async ctx => {
    if (ctx.path === ZALO_OWNER_STYLE_PATH) return ownerStyle(ctx);
    const { req, res, path, method, auth, json, readBody } = ctx;
    const allowed = paths.get(path);
    if (!allowed) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const phone = deps.phone(auth) && ((path === AI_TWIN_PATH && method === "GET") ||
      ((path === AI_TWIN_LOOKUP_PATH || path === AI_TWIN_PREVIEW_PATH) && method === "POST"));
    const owner = deps.owner(auth);
    if (!owner && !phone) return json(res, 404, { error: "not_found" });
    const store = deps.storeFor(auth);
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
        ...(deps.desktop && ownerStyleAllowed(auth) ? { canReviewOwnerStyle: true } : {}),
      });
    }

    try {
      if (!authorized()) return json(res, 404, { error: "not_found" });
      if (method === "GET" && path === exactLessonsPath) {
        if (deps.blocked()) return json(res, 409, { error: "twin_workspace_busy" });
        const { twin, lessons } = deps.store.get();
        const shareable = (s: string) => !holdsCredential(s) && redactSecretsInText(s) === s;
        return json(res, 200, {
          twin: twin && { id: twin.id, revision: twin.revision, paused: twin.paused },
          lessons:
            twin && !twin.paused
              ? (lessons ?? []).filter((l) => l.origin === "manual" && shareable(l.question) && shareable(l.answer))
              : [],
        });
      }
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
      if (path === AI_TWIN_FORGET_MANY_PATH) {
        const input = forgetTwinLessonsInput.safeParse(body);
        if (!input.success) return json(res, 400, { error: "invalid_twin" });
        const view = store.forgetLessons(input.data);
        drafts.cancel();
        return replyProfile(200, view);
      }
      if (path === AI_TWIN_LESSONS_PATH) {
        const next = method === "POST" ? saveTwinLessonInput.safeParse(body) : deleteTwinLessonInput.safeParse(body);
        if (!next.success) return json(res, 400, { error: "invalid_twin" });
        let source: TwinExampleSource | undefined;
        if ("saveAsLesson" in next.data && next.data.example) {
          const { thread, message } = next.data.example;
          source = deps.source(auth, thread, message);
          const current = store.get();
          if (!current.twin || current.twin.paused || !current.controls?.sourceIds.includes(thread) || !source || source.digest !== next.data.example.digest ||
              !deps.learning(auth, [thread]).examples.some((example) => example.message === message)) {
            throw new TwinConflict();
          }
        }
        const view = "saveAsLesson" in next.data ? store.saveLesson(next.data, source) : store.forgetLesson(next.data);
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
        const { zaloRecipe: recipeId, zaloSource, zaloEvidence } = input.data;
        if (Boolean(recipeId || zaloEvidence) !== Boolean(zaloSource) || (zaloEvidence && (recipeId || ("useMemory" in input.data && input.data.useMemory)))) return json(res, 400, { error: "invalid_zalo_source" });
        const desktopSource = owner && auth.kind === "loopback" && auth.desktopOwner === true && !auth.companionDevice;
        if (zaloEvidence && !desktopSource) return json(res, 403, { error: "source_unavailable" });
        const recipe = recipeId && desktopSource ? deps.zaloRecipe?.(recipeId) : undefined;
        if (recipeId && !recipe) return json(res, 403, { error: "recipe_unavailable" });
        const useMemory = isLookup || ("useMemory" in input.data && input.data.useMemory === true);
        const disconnected = new AbortController();
        const close = () => disconnected.abort();
        res.once("close", close);
        let observed: string[] = [];
        function assertCurrent() {
          if (!authorized() || deps.blocked()) throw new TwinConflict();
          const latest = store.get();
          if (latest.twin?.revision !== revision || latest.twin.id !== id) throw new TwinConflict();
          const usable = new Set(uniqueLessons(latest.lessons ?? []).map(entry => entry.id));
          if (observed.some(lessonId => !usable.has(lessonId))) throw new TwinConflict();
        }
        try {
          const exactMatch = useMemory ? store.lookupLesson({ id, revision, question }) : null;
          const allowedLessons = uniqueLessons(current.lessons ?? []).filter(entry => entry.allowProvider);
          if (useMemory) observed = exactMatch ? [exactMatch.id] : allowedLessons.map(entry => entry.id);
          assertCurrent();
          const lesson = exactMatch ? (isLookup || exactMatch.allowProvider ? exactMatch : null)
            : useMemory ? await drafts.recall(twin, question, allowedLessons, key, disconnected.signal, assertCurrent) : null;
          assertCurrent();
          if (isLookup) return json(res, 200, { lesson, ...(lesson && !exactMatch ? { match: "semantic" } : {}) });

          const style = useMemory ? deps.learnedStyle(auth, current.controls?.sourceIds ?? []) : undefined;
          const draft = await drafts.draft(twin, question, key, disconnected.signal, { lesson, style, recipe, zaloSource, zaloEvidence });
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
