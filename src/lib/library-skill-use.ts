import { api } from "@/state/api";
import { t } from "./i18n";

export async function activateLibrarySkill(
  chat: { botId: string; threadId: string },
  skill: { name: string; enabled: boolean },
): Promise<void> {
  const botPath = `/api/bots/${encodeURIComponent(chat.botId)}`;
  if (!skill.enabled) await api(`/api/skills-library/${encodeURIComponent(skill.name)}`, {
    method: "PATCH", body: JSON.stringify({ enabled: true }),
  });
  await api(`${botPath}/skills-library`, {
    method: "PATCH", body: JSON.stringify({ name: skill.name, assigned: true }),
  });
  const { skills } = await api<{ skills: { name: string; origin: string; enabled: boolean }[] }>(
    `${botPath}/skills?threadId=${encodeURIComponent(chat.threadId)}`,
  );
  if (!skills.some((entry) => entry.name === skill.name && entry.enabled && entry.origin === "library")) {
    throw new Error(t("skills.library.unavailable"));
  }
}
