export function registeredBotUsernames(bots: readonly { id: string; groupUsername?: unknown }[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const bot of bots) if (typeof bot.groupUsername === "string" && /^bot_k[a-f0-9]{64}$/.test(bot.groupUsername)) counts.set(bot.groupUsername, (counts.get(bot.groupUsername) ?? 0) + 1);
  return new Map(bots.flatMap(bot => typeof bot.groupUsername === "string" && counts.get(bot.groupUsername) === 1 ? [[bot.id, bot.groupUsername] as const] : []));
}
