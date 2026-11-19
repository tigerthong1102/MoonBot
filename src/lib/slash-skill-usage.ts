import { offersSkillCommand, skillMentions } from "../../shared/skill-command";

const STORAGE_KEY = "omb-slash-skill-usage";
const MAX_TRACKED = 256;

interface Usage {
  counts: [string, number][];
  sends: string[];
}

function readUsage(): Usage {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Usage> | null;
    return {
      counts: (value?.counts ?? []).filter(([name, count]) =>
        typeof name === "string" && offersSkillCommand(name) && Number.isSafeInteger(count) && count > 0),
      sends: (value?.sends ?? []).filter((id) => typeof id === "string").slice(-MAX_TRACKED),
    };
  } catch {
    return { counts: [], sends: [] };
  }
}

export function slashSkillUsage(): ReadonlyMap<string, number> {
  return new Map(readUsage().counts);
}

export function recordSlashSkillUse(text: string, sendId: string): void {
  const names = skillMentions(text);
  if (!names.length) return;
  const { counts, sends } = readUsage();
  if (sends.includes(sendId)) return;
  const usage = new Map(counts);
  for (const name of names) usage.set(name, (usage.get(name) ?? 0) + 1);
  const ranked = [...usage.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TRACKED);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ counts: ranked, sends: [...sends, sendId].slice(-MAX_TRACKED) }));
  } catch {}
}
