import { randomUUID } from "node:crypto";
import type { ZaloModelOffer } from "../../shared/zalo-model-analysis.ts";
import { sameModelSelection } from "../../shared/thread-model.ts";
import type { ProviderInstance } from "../contracts.ts";
import type { ModelSelection } from "../../shared/wire.ts";
import type { KnowledgeAnswerDeps } from "./knowledge-answers.ts";
import { zaloModelEvidence, zaloModelRequest } from "../zalo-model-evidence.ts";
import { PASS, type RouteHandler } from "./table.ts";

type Deps = Pick<KnowledgeAnswerDeps, "store" | "accessible" | "unavailable" | "writer" | "busy"> & {
  refusal(botId: string, threadId: string, admit?: boolean): ReturnType<KnowledgeAnswerDeps["refusal"]>;
};
type Destination = { instance: ProviderInstance; selection: ModelSelection };
class SelectionChanged extends Error {}
export function createZaloModelAnalysis(deps: Deps, desktop: boolean, instance: (id: string) => ProviderInstance | undefined | null): RouteHandler {
  let pending: (Destination & { token: string; bot: string; thread: string; expires: number }) | null = null;
  let active = false;
  return async ({ req, res, path, url, method, auth, json, readBody }) => {
    const match = /^\/api\/bots\/([\w-]+)\/zalo-model-analysis$/.exec(path);
    if (!match) return PASS;
    res.setHeader("Cache-Control", "private, no-store");
    const botId = match[1]!, threadId = url.searchParams.get("thread") ?? "";
    const enabled = () => desktop && process.env.STARTUPBOT_ZALO_MODEL_ANALYSIS !== "0" && auth.kind === "loopback" &&
      auth.desktopOwner === true && !auth.companionDevice && auth.trust !== "service";
    if (!enabled()) return json(res, 403, { error: "desktop_owner_required" });
    if (method !== "GET" && method !== "POST") return json(res, 405, { error: "method_not_allowed" });
    const available = () => enabled() && deps.store.taskByThread(botId, threadId) && deps.accessible(auth, botId, threadId);
    const destination = (admit = true) => {
      const bot = deps.store.bot(botId);
      if (!bot || !available() || deps.unavailable(botId) || deps.refusal(botId, threadId, admit) ||
          (admit && deps.busy(botId, threadId))) return null;
      const writer = deps.writer(auth, bot, threadId);
      if (!writer || "code" in writer) return null;
      const target = instance(writer.selection.instanceId);
      return target && { instance: target, selection: writer.selection, writer };
    };
    if (!available()) return json(res, 404, { error: "source_unavailable" });
    if (active) return json(res, 409, { error: "analysis_busy" });
    const current = destination();
    if (!current) return json(res, 422, { error: "isolated_model_unavailable" });
    if (method === "GET") {
      const token = randomUUID();
      pending = { token, bot: botId, thread: threadId, expires: Date.now() + 300_000, selection: { ...current.selection }, instance: current.instance };
      return json(res, 200, { token, model: current.selection.model, provider: current.instance.displayName || current.instance.instanceId } satisfies ZaloModelOffer);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) return json(res, 415, { error: "json_required" });
    const body: unknown = await readBody(req, 64_000);
    const parsed = zaloModelRequest.safeParse(body);
    // The HTTP harness makes its parsed body available to request observers after this route returns.
    if (body && typeof body === "object" && "lines" in body) delete body.lines;
    if (!parsed.success) return json(res, 400, { error: "invalid_analysis" });
    const offer = pending;
    if (active || !offer || parsed.data.token !== offer.token || offer.bot !== botId || offer.thread !== threadId)
      return json(res, 409, { error: "review_destination_again" });
    pending = null;
    active = true;
    const disconnected = new AbortController();
    const stop = () => disconnected.abort();
    res.once("close", stop);
    const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(65_000)]);
    function check(admit = true) {
      const actual = destination(admit);
      if (signal.aborted || !actual || (admit && offer!.expires <= Date.now()) || actual.instance !== offer!.instance ||
          !sameModelSelection(actual.selection, offer!.selection)) throw new SelectionChanged();
      return actual;
    }
    try {
      if (res.destroyed) return;
      const selected = check();
      const evidence = zaloModelEvidence(parsed.data);
      const raw = await selected.writer.generateText(evidence.prompt, {
        signal, timeoutMs: 65_000, started: check, beforeRequest: check,
      });
      check(false);
      const output = evidence.validate(raw);
      return output ? json(res, 200, { findings: output }) : json(res, 502, { error: "unsupported_model_evidence" });
    } catch (error) {
      if (disconnected.signal.aborted) return;
      return error instanceof SelectionChanged ? json(res, 409, { error: "review_destination_again" }) :
        json(res, 502, { error: "analysis_unavailable" });
    } finally {
      active = false;
      res.off("close", stop);
    }
  };
}
