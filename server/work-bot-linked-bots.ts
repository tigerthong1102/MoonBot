import type { WorkBotLink } from "./work-bot-message-db.ts";

export function workBotsLinked(first: string, second: string, linksForBot: (botId: string) => readonly WorkBotLink[]): boolean {
  const seen = new Set([first]);
  const pending = [first];
  for (let index = 0; index < pending.length; index++) {
    const current = pending[index]!;
    for (const link of linksForBot(current)) {
      const next = link.sourceBotId === current ? link.targetBotId : link.targetBotId === current ? link.sourceBotId : undefined;
      if (!next || seen.has(next)) continue;
      if (next === second) return true;
      seen.add(next);
      pending.push(next);
    }
  }
  return false;
}
