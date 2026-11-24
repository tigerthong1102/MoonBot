import type { WorkBotLink } from "./work-bot-message-db.ts";

export function linkedWorkBotOwners(botId: string, linksForBot: (botId: string) => readonly WorkBotLink[]): Set<string> {
  const seen = new Set([botId]);
  const pending = [botId];
  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index]!;
    for (const link of linksForBot(current)) {
      const next = link.sourceBotId === current ? link.targetBotId : link.targetBotId === current ? link.sourceBotId : undefined;
      if (!next || seen.has(next)) continue;
      seen.add(next);
      pending.push(next);
    }
  }
  seen.delete(botId);
  return seen;
}
