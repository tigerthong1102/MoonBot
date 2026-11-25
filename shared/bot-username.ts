import { isMentionBoundary, isMentionNameContinuation } from "./mention-boundary.ts";

export function botUsername(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return `bot_u${id.replaceAll("-", "")}`;
  let encoded = "";
  for (let i = 0; i < id.length; i += 1) encoded += id.charCodeAt(i).toString(16).padStart(4, "0");
  return `bot_x${encoded}`;
}

export function maskPickedBotUsernames(text: string, ids: readonly string[]): string {
  const usernames = ids.map(botUsername);
  let masked = text;
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    if (!isMentionBoundary(text, at)) continue;
    const match = usernames.find(name => text.slice(at + 1, at + 1 + name.length).toLowerCase() === name && !isMentionNameContinuation(text.slice(at + 1 + name.length)));
    if (!match) continue;
    masked = `${masked.slice(0, at)}${" ".repeat(match.length + 1)}${masked.slice(at + match.length + 1)}`;
    at += match.length;
  }
  return masked;
}
