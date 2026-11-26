import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile.ts";
import { MAX_INSTRUCTION_CASES, type InstructionDraft, type InstructionStudioView } from "../../shared/instruction-studio.ts";
import { sameModelSelection } from "../../shared/thread-model.ts";
import { EFFORT_LEVELS, type ModelSelection } from "../../shared/wire.ts";
import { flushProfileHistory, readHistory } from "../profile-versions.ts";
import { writeFileAtomic } from "../atomic.ts";
import { parseBotProfilePatch } from "../bot-profile.ts";
import { personKey } from "../person-key.ts";
import { profileRevision } from "../profile-revision.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { SideJobText } from "../side-jobs.ts";
import type { BotRecord } from "../store.ts";
import { botPersona, buildSystemPrompt } from "../system-prompt.ts";
import { PASS, type RouteHandler } from "./table.ts";

const revision = z.string().regex(/^[0-9a-f]{64}$/);
const snapshot = z.object({ id: z.uuid().nullable(), revision }).strict();
const model = z.object({
  instanceId: z.string().min(1).max(200), model: z.string().min(1).max(500),
  effort: z.enum(EFFORT_LEVELS).optional(), variant: z.string().min(1).max(100).optional(),
}).strict();
const fields = {
  selection: model.optional(),
  soul: z.string().refine(text => Buffer.byteLength(text, "utf8") <= BOT_PROFILE_LIMITS.soul),
  cases: z.array(z.object({ question: z.string().trim().min(1).max(2000), expected: z.string().trim().min(1).max(500) }).strict()).max(MAX_INSTRUCTION_CASES),
};
const saved = z.object({ id: z.uuid(), baseRevision: revision, ...fields }).strict();
const save = snapshot.extend(fields);
const restore = snapshot.extend({ version: z.uuid() });
const testCase = snapshot.extend({ index: z.int().min(0).max(MAX_INSTRUCTION_CASES - 1) });
const normalize = (text: string) => text.normalize("NFC").toLowerCase();
export function createInstructionStudio(deps: {
  dataDir: string;
  bot(id: string): BotRecord | null | undefined;
  mayEdit(auth: RequestAuth, id: string): boolean;
  rules(): string | undefined;
  writer(id: string, selection: ModelSelection): SideJobText | null;
  refusal(bot: BotRecord, selection: ModelSelection, publishing: boolean): string | null;
  publish(bot: BotRecord, soul: string, selection: ModelSelection, via: string): void;
}) {
  const folder = (botId: string) => join(deps.dataDir, "instruction-drafts", botId);
  const running = new Set<string>();
  const routes: RouteHandler = async ({ path, method, auth, res, json, readBody, req }) => {
    const match = /^\/api\/bots\/([\w-]+)\/instruction-studio(?:\/(save|publish|reset|test|restore))?$/.exec(path);
    if (!match) return PASS;
    const [, botId, action] = match;
    res.setHeader("cache-control", "private, no-store");
    const authorized = () => deps.mayEdit(auth, botId);
    if (!authorized()) return json(res, 403, { error: "Bot editing access is required." });
    if ((!action && method !== "GET") || (action && method !== "POST")) return json(res, 405, { error: "Method not allowed." });
    const body = action ? await readBody(req, 350_000) : undefined;
    await flushProfileHistory(botId);
    const bot = deps.bot(botId);
    if (!bot || !authorized()) return json(res, 404, { error: "Bot unavailable." });
    const person = auth.kind === "session" ? personKey(auth.session) : "local-owner";
    const file = join(folder(botId), person + ".json");
    const currentRevision = (record: BotRecord) => createHash("sha256").update(JSON.stringify([
      profileRevision(record), record.modelSelection, record.replyStyle, deps.rules(),
    ])).digest("hex");
    const liveRevision = currentRevision(bot);
    const read = (): InstructionDraft => {
      try {
        const draft = saved.parse(JSON.parse(readFileSync(file, "utf8")));
        return { ...draft, selection: draft.selection ?? bot.modelSelection };
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return { id: null, baseRevision: liveRevision, soul: bot.soul ?? "", selection: bot.modelSelection, cases: [] };
      }
    };
    const storeDraft = (soul: string, cases: InstructionDraft["cases"], baseRevision: string, selection: ModelSelection) => {
      const next = { id: randomUUID(), soul, cases, baseRevision, selection };
      mkdirSync(folder(botId), { recursive: true, mode: 0o700 });
      writeFileAtomic(file, JSON.stringify(next), { mode: 0o600 });
      return next;
    };
    const versions = () => readHistory(botId, 500).filter(row => row.field === "configuration" && row.modelBefore);
    const view = (record: BotRecord, draft: InstructionDraft): InstructionStudioView => ({
      revision: currentRevision(record), liveSoul: record.soul ?? "", draft, liveSelection: record.modelSelection,
      history: versions().map(row => ({ id: row.id, at: row.at, instanceId: row.modelBefore!.instanceId, model: row.modelBefore!.model,
        instructionsPreview: (row.before ?? "").slice(0, 200),
        effort: row.modelBefore!.effort ?? row.modelBefore!.variant, canRestore: row.canRestore === true })),
      canTest: !!deps.writer(record.id, record.modelSelection) && !!deps.writer(record.id, draft.selection),
    });
    const draft = read();
    if (!action) return json(res, 200, view(bot, draft));
    const schema = action === "save" ? save : action === "test" ? testCase : action === "restore" ? restore : snapshot;
    const input = schema.safeParse(body);
    if (!input.success) return json(res, 400, { error: "Invalid draft, revision or test case." });
    const stale = () => json(res, 409, { error: "The bot or draft changed. Reload the draft to see the current version." });
    if (input.data.id !== draft.id || input.data.revision !== liveRevision) return stale();
    if (action === "reset") return json(res, 200, view(bot, storeDraft(bot.soul ?? "", draft.cases, liveRevision, bot.modelSelection)));
    if (action !== "restore" && draft.baseRevision !== liveRevision) return stale();
    if (action === "save") {
      const { soul, cases, selection = bot.modelSelection } = save.parse(input.data);
      const checked = parseBotProfilePatch({ soul });
      if (!checked.ok) return json(res, 400, { error: checked.error });
      if (!sameModelSelection(selection, bot.modelSelection)) {
        const refusal = deps.refusal(bot, selection, false);
        if (refusal) return json(res, 422, { error: refusal });
      }
      return json(res, 200, view(bot, storeDraft(checked.patch.soul ?? "", cases, liveRevision, selection)));
    }
    if (action === "publish" || action === "restore") {
      let soul = draft.soul, selection = draft.selection;
      if (action === "restore") {
        const row = versions().find(entry => entry.id === restore.parse(input.data).version);
        if (!row?.canRestore || typeof row.before !== "string" || !row.modelBefore) {
          return json(res, 409, { error: "This exact version cannot be restored." });
        }
        const checked = model.safeParse(row.modelBefore);
        if (!checked.success || !parseBotProfilePatch({ soul: row.before }).ok) return json(res, 409, { error: "Invalid saved version." });
        soul = row.before;
        selection = checked.data;
      } else if (!draft.id) return json(res, 409, { error: "Save a draft first." });
      const modelChanged = !sameModelSelection(selection, bot.modelSelection);
      if (modelChanged) {
        const refusal = deps.refusal(bot, selection, true);
        if (refusal) return json(res, 409, { error: refusal });
      }
      const keepDraft = action === "restore" && (draft.soul !== (bot.soul ?? "") || !sameModelSelection(draft.selection, bot.modelSelection));
      if (modelChanged || soul !== (bot.soul ?? "")) deps.publish(bot, soul, selection, action === "restore" ? "rollback" : "draft");
      const updated = deps.bot(botId)!;
      if (!keepDraft) storeDraft(soul, draft.cases, currentRevision(updated), selection);
      await flushProfileHistory(botId);
      const latest = deps.bot(botId);
      if (!latest || !authorized()) return json(res, 404, { error: "Bot unavailable." });
      return json(res, 200, view(latest, read()));
    }
    if (!draft.id) return json(res, 409, { error: "Save a draft first." });
    const { index } = testCase.parse(input.data);
    const item = draft.cases[index];
    if (!item) return json(res, 400, { error: "Test case unavailable." });
    if (running.has(file)) return json(res, 409, { error: "Another comparison is running for this draft." });
    if (!deps.writer(bot.id, bot.modelSelection) || !deps.writer(bot.id, draft.selection)) return json(res, 422, { error: "The bot's selected engine cannot run an isolated instruction test." });
    const closed = new AbortController();
    const disconnect = () => closed.abort();
    res.once("close", disconnect);
    const signal = AbortSignal.any([closed.signal, AbortSignal.timeout(90_000)]);
    const current = () => {
      const record = deps.bot(botId);
      return !signal.aborted && authorized() && record && currentRevision(record) === liveRevision && read().id === draft.id;
    };
    const run = async (soul: string, selection: ModelSelection) => {
      const prompt = buildSystemPrompt(botPersona(bot), soul, [], undefined, { rules: deps.rules(), replyStyle: bot.replyStyle }).text;
      const engine = deps.writer(bot.id, selection);
      if (!engine) throw new Error("Engine unavailable.");
      const answer = (await engine.generateText(prompt + "\n\nAnswer the following user's question.\n" + item.question, { signal, timeoutMs: 40_000 })).trim();
      if (!answer || answer.length > 40_000) throw new Error("Unusable response.");
      return { answer, pass: normalize(answer).includes(normalize(item.expected)) };
    };
    running.add(file);
    try {
      const live = await run(bot.soul ?? "", bot.modelSelection);
      if (!current()) return stale();
      const candidate = await run(draft.soul, draft.selection);
      if (!current()) return stale();
      return json(res, 200, { live, draft: candidate });
    } catch (error) {
      if (closed.signal.aborted) return;
      const status = (error as { status?: number }).status;
      const isolated = error instanceof Error && error.message === "Claude cannot run an isolated text preview with the active settings.";
      if (isolated) return json(res, 422, { error: "This Claude CLI or its active settings do not support isolated tests." });
      return json(res, status === 429 || status === 402 ? status : 503, { error: "Test interrupted. Check the selected engine and spending limits." });
    } finally {
      res.off("close", disconnect);
      running.delete(file);
    }
  };
  return { routes, forget: (id: string) => rmSync(folder(id), { recursive: true, force: true }) };
}
