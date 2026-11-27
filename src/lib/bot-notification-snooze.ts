const prefix = "startupbot.bot-notification-snooze.";
const changed = "startupbot:bot-notification-snooze";
export const SNOOZE_HOUR = 3_600_000;
export function snoozedUntil(botId: string, now = Date.now()) {
  try {
    const time = Number(localStorage.getItem(prefix + botId));
    return Number.isFinite(time) && time > now ? time : 0;
  } catch { return 0; }
}
export function setBotSnooze(botId: string, until: number) {
  if (until > Date.now()) localStorage.setItem(prefix + botId, String(until));
  else localStorage.removeItem(prefix + botId);
  window.dispatchEvent(new Event(changed));
}
export function onSnoozeChanged(update: () => void) {
  window.addEventListener(changed, update);
  window.addEventListener("storage", update);
  return () => { window.removeEventListener(changed, update); window.removeEventListener("storage", update); };
}
