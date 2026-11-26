export function inboxBotLabel(bot) {
  return bot.username ? `${bot.name} (@${bot.username})` : bot.name;
}
