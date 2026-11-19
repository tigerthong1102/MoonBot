import names from "../../../shared/app-language-names.json";
import letters from "./inbox-mail-text.json";

export function supportedInboxLanguage(value: string): boolean {
  return Object.hasOwn(names, value);
}
export function inboxLanguage(value: string | null) {
  const parts = (value ?? "").toLowerCase().replaceAll("_", "-").split("-");
  if (parts[0] === "pt") return "pt-br";
  if (
    parts[0] === "zh" &&
    parts.some((p) => ["hant", "hk", "tw", "mo"].includes(p))
  )
    return "zh-tw";
  return supportedInboxLanguage(parts[0]) ? parts[0] : "en";
}
export function mailText(
  tag: string,
  key: keyof typeof letters.en,
  params: Record<string, string> = {},
) {
  const catalog = letters[tag as keyof typeof letters] ?? letters.en;
  return catalog[key].replace(
    /\{(\w+)\}/g,
    (token, name: string) => params[name] ?? token,
  );
}
