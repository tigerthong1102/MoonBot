import catalog from "../../skills/catalog/index.json";
import { activeLocale } from "./i18n";

const catalogBySource = new Map(catalog.map((entry) => [entry.source, entry]));

export function catalogEntry(skill: { name: string; source: string }) {
  const entry = catalogBySource.get(skill.source);
  return entry?.name === skill.name ? entry : undefined;
}

export function skillDescription(skill: { name: string; source: string; description: string }): string {
  const entry = catalogEntry(skill);
  const locale = activeLocale();
  if (locale === "vi") return entry?.summaryVi ?? skill.description;
  if (locale === "zh") return entry?.summaryZh ?? skill.description;
  if (locale === "zh-tw") return entry?.summaryZhTw ?? skill.description;
  return entry?.summaryEn ?? skill.description;
}
