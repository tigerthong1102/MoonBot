import { randomUUID } from "node:crypto";
import { z } from "zod";
import { OWNER_STYLE_TRAITS, ZALO_OWNER_STYLE_PATH, type OwnerStyleTrait } from "../../shared/zalo-owner-style.ts";
import { createAiTwinStore, TwinConflict, twinVersionInput } from "../ai-twin.ts";
import { twinLearningSample } from "../ai-twin-learning.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const proposalInput = z.discriminatedUnion("action", [
  twinVersionInput.extend({ action: z.literal("propose"), provenance: z.literal("owner-desktop-editor"), authorConsent: z.literal(true),
    sample: z.string().min(12).max(750) }),
  twinVersionInput.extend({ action: z.literal("approve"), proposalId: z.uuid(), approveConsent: z.literal(true),
    traits: z.array(z.enum(OWNER_STYLE_TRAITS)).min(1).max(OWNER_STYLE_TRAITS.length) }),
  twinVersionInput.extend({ action: z.literal("decline"), proposalId: z.uuid() }),
  twinVersionInput.extend({ action: z.literal("forget") }),
]);

function describeSample(raw: string) {
  const text = twinLearningSample(raw);
  if (!text || /\p{N}{4,}|\b(?:otp|pin|password|secret|token)\b|mật khẩu|mã xác thực/iu.test(text)) return;
  const traits: OwnerStyleTrait[] = [];
  if ((text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) <= 20) traits.push("brief");
  if (/^\s*(?:[-*•]|\d+[.)])\s+\S/mu.test(text)) traits.push("list");
  if (/[?？]\s*$/u.test(text)) traits.push("question");
  if (/^\s*(?:dạ|vâng)(?:[ ,.\n]|$)/iu.test(text)) traits.push("polite");
  const first = /^(?:\s*(?:dạ|vâng)[ ,.!]*)?\s*(em|mình|tôi)\s/iu.exec(text)?.[1]?.toLocaleLowerCase("vi");
  if (first) traits.push(first === "mình" ? "minh" : first === "tôi" ? "toi" : "em");
  return traits.length ? traits : undefined;
}
export const ownerStyleAllowed = (auth: RequestAuth) => auth.kind === "loopback" && auth.desktopOwner === true &&
  auth.trust !== "service" && !auth.companionDevice;

export function createOwnerStyleRoutes(deps: {
  store: ReturnType<typeof createAiTwinStore>; owner: (auth: RequestAuth) => boolean; blocked: () => boolean;
  cancelDrafts: () => void; now?: () => number;
}): RouteHandler {
  let pending: { id: string; revision: number; proposalId: string; expires: number; traits: OwnerStyleTrait[] } | undefined;
  const now = deps.now ?? Date.now;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== ZALO_OWNER_STYLE_PATH) return PASS;
    res.setHeader("Cache-Control", "private, no-store");
    const authorized = () => ownerStyleAllowed(auth) && deps.owner(auth);
    if (!authorized()) return json(res, 404, { error: "not_found" });
    try {
      const twin = deps.store.get().twin;
      if (!twin || deps.blocked()) return json(res, 409, { error: "twin_changed" });
      if (pending && (pending.id !== twin.id || pending.revision !== twin.revision || twin.paused || pending.expires <= now())) pending = undefined;
      if (method === "GET") return json(res, 200, { id: twin.id, revision: twin.revision, paused: twin.paused,
        approved: deps.store.ownerEditorStyle(twin) ?? null });
      if (method !== "POST") return json(res, 405, { error: "method-not-allowed" });
      if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") return json(res, 415, { error: "json-required" });
      const body = await readBody(req, 8192);
      const parsed = proposalInput.safeParse(body);
      if (body && typeof body === "object") for (const k of Object.keys(body)) delete (body as Record<string, unknown>)[k];
      if (!parsed.success) return json(res, 400, { error: "invalid-style-action" });
      if (res.destroyed) return;
      if (!authorized()) return json(res, 404, { error: "not_found" });
      const input = parsed.data;
      const current = deps.store.get().twin;
      if (deps.blocked() || !current || current.id !== input.id || current.revision !== input.revision ||
          (current.paused && input.action !== "forget")) throw new TwinConflict();
      if (input.action === "propose") {
        const traits = describeSample(input.sample);
        pending = undefined;
        if (!traits) return json(res, 422, { error: "unsupported-sample" });
        pending = { id: current.id, revision: current.revision, proposalId: randomUUID(), expires: now() + 300_000, traits };
        return json(res, 200, pending);
      }
      if (input.action === "forget") {
        deps.store.setOwnerEditorStyle(input);
      } else {
        if (!pending || pending.id !== current.id || pending.revision !== current.revision || pending.expires <= now() ||
            input.proposalId !== pending.proposalId) throw new TwinConflict();
        if (input.action === "approve") {
          const selected = pending.traits.filter(t => input.traits.includes(t));
          if (selected.length !== input.traits.length) return json(res, 400, { error: "invalid-traits" });
          deps.store.setOwnerEditorStyle(input, { provenance: "owner-desktop-editor", approvedAt: now(), traits: selected });
        }
      }
      pending = undefined;
      deps.cancelDrafts();
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, error instanceof TwinConflict ? 409 : 503, { error: error instanceof TwinConflict ? "twin_changed" : "style_unavailable" });
    }
  };
}
