import languageNames from "../../shared/app-language-names.json";
import en from "./en.json";

export { en };
export type LocaleKey = keyof typeof en;
export type LocalePack = Partial<Record<LocaleKey, string>>;

const packLoaders = {
  de: () => import("./de.json"),
  es: () => import("./es.json"),
  fr: () => import("./fr.json"),
  hi: () => import("./hi.json"),
  ja: () => import("./ja.json"),
  "pt-br": () => import("./pt-br.json"),
  zh: () => import("./zh.json"),
  "zh-tw": () => import("./zh-tw.json"),
  uk: () => import("./uk.json"),
  vi: () => import("./vi.json"),
  tr: () => import("./tr.json"),
  pl: () => import("./pl.json"),
  ru: () => import("./ru.json"),
  it: () => import("./it.json"),
  ko: () => import("./ko.json"),
} satisfies Record<string, () => Promise<{ default: LocalePack }>>;

export type PackName = "en" | keyof typeof packLoaders;

/** Every language tag the app answers to, and the pack it shows. */
export const localePacks: Readonly<Record<string, PackName>> = {
  en: "en",
  de: "de",
  es: "es",
  fr: "fr",
  hi: "hi",
  ja: "ja",
  pt: "pt-br",
  "pt-br": "pt-br",
  zh: "zh",
  "zh-hant": "zh-tw",
  "zh-hk": "zh-tw",
  "zh-mo": "zh-tw",
  "zh-tw": "zh-tw",
  uk: "uk",
  vi: "vi",
  tr: "tr",
  pl: "pl",
  ru: "ru",
  it: "it",
  ko: "ko",
};

/** The packs this page has loaded, under every tag that shows them: English, and each one loadLocalePack fetched. */
export const locales: Record<string, LocalePack> = { en };

export async function loadLocalePack(tag: string): Promise<LocalePack | undefined> {
  const name = localePacks[tag];
  if (locales[tag] || !name || name === "en") return locales[tag];
  const pack: LocalePack = (await packLoaders[name]()).default;
  for (const [alias, shown] of Object.entries(localePacks)) if (shown === name) locales[alias] ??= pack;
  return pack;
}

export const localeChoices: ReadonlyArray<{ code: string; label: string }> =
  Object.entries(languageNames).map(([code, label]) => ({ code, label }));
