import { randomUUID } from "node:crypto";
import type { BotRecord, Store } from "../store.ts";
import type { ProviderInstance } from "../contracts.ts";
import { runCouncil, type CouncilMember } from "../room-council.ts";
import { serverLine } from "../server-lines.ts";
import { measuredSpend } from "../model-prices.ts";
import type { PriceList } from "../prices.ts";
import type { UsageRow, UsageTrigger } from "../usage-ledger.ts";
import type { UsageCapsConfig } from "../usage-caps-config.ts";

export async function invokeRoomCouncil(input: {
  store: Store; threadId: string; messageId: string; language?: string; signal: AbortSignal; chairId?: string;
  members: BotRecord[]; botIds: Set<string>; question: { question: string; critique: boolean }; trigger?: UsageTrigger;
  eligible(id: string): { bot: BotRecord; instance: ProviderInstance; model: string; seat: CouncilMember["seat"]; call: NonNullable<ProviderInstance["generateText"]> } | undefined;
  checkBudget(id: string): void; cap(): UsageCapsConfig["run"]; prices(): PriceList | null;
  book(row: Omit<UsageRow, "at" | "costSource">, tokensReported: boolean): void;
  refreshUsage(): Promise<void>;
}) {
  const candidates: CouncilMember[] = [];
  const councilUsage: { tokens: number | null; usd: number | null } = { tokens: 0, usd: 0 };
  for (const member of input.members) {
    const writer = input.eligible(member.id);
    if (!writer) continue;
    candidates.push({ id: member.id, model: writer.model, seat: writer.seat, ask: async (prompt, signal) => {
      const live = input.eligible(member.id);
      if (!live || live.model !== writer.model || live.instance !== writer.instance) throw new Error("Council membership or provider changed");
      const checkBudget = () => {
        input.checkBudget(member.id);
        const cap = input.cap();
        if ((cap?.tokens && (councilUsage.tokens === null || councilUsage.tokens >= cap.tokens)) ||
            (cap?.usd && (councilUsage.usd === null || councilUsage.usd >= cap.usd))) throw new Error("Council budget reached");
      };
      checkBudget();
      let reported = false;
      let answer: string;
      try {
        answer = await live.call.call(live.instance, prompt, {
          model: live.model, requireIsolatedText: true, signal, timeoutMs: 120000, beforeRequest: checkBudget,
          onUsage: usage => {
            reported = true;
            const { tokens, usd: cost } = measuredSpend(usage.model, live.instance.driverKind, usage, input.prices());
            const row = { botId: member.id, botName: member.name, threadId: input.threadId, usageId: randomUUID(),
              model: usage.model, instanceId: live.instance.instanceId, driverKind: live.instance.driverKind,
              input: usage.input ?? 0, output: usage.output ?? 0, cachedInput: usage.cachedInput,
              costUsd: usage.costUsd ?? null, trigger: input.trigger ?? { kind: "owner" as const } };
            councilUsage.tokens = councilUsage.tokens === null || tokens === null ? null : councilUsage.tokens + tokens;
            councilUsage.usd = councilUsage.usd === null || cost === null ? null : councilUsage.usd + cost;
            input.book(row, tokens !== null);
          },
        });
      } finally {
        if (!reported) {
          councilUsage.tokens = null;
          councilUsage.usd = null;
        }
      }
      const current = input.eligible(member.id);
      if (!current || current.instance !== live.instance || current.model !== live.model) throw new Error("Council seat changed during this round");
      return answer;
    } });
  }

  for (const candidate of candidates) input.botIds.add(candidate.id);
  await runCouncil({ ...input.question, members: candidates, chairId: input.chairId, signal: input.signal, language: input.language,
    notice: body => { input.store.appendMessage(input.threadId, { role: "bot", kind: "activity", replyToId: input.messageId, tool: { name: body, ok: false } }); },
    post: (member, phase, body) => {
      const bot = input.eligible(member.id)?.bot;
      if (!bot) return;
      const label = serverLine(input.language, ({ answer: "server.roomCouncil.answer", critique: "server.roomCouncil.critique", summary: "server.roomCouncil.summary" } as const)[phase]);
      input.store.appendMessage(input.threadId, { role: "bot", kind: "text", from: { botId: bot.id, name: bot.name, color: bot.color },
        replyToId: input.messageId, text: `**${label} · ${member.seat} (${member.model})**\n\n${body}` });
    },
  }).finally(input.refreshUsage);
}
