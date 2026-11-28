import { readFileSync } from "node:fs";
import { catalogLanguage, catalogTranslator } from "../../cloudflare/control-plane/inbox/public/catalog-i18n.js";
import languageNames from "../../shared/app-language-names.json" with { type: "json" };

const sharedKeys = {
  transcript: "settings.appearance.chat",
  copy: "connect.copy",
  retry: "connectors.action.reconnect",
  email: "email.address",
  login: "settings.account.signIn",
  logout: "accounts.signOut",
  history: "personalInbox.conversations",
  new: "personalInbox.newConversation",
  empty: "personalInbox.newConversation",
  rename: "rail.rename",
  remove: "common.delete",
  send: "chat.send",
  stop: "chat.stop",
  you: "personalInbox.you",
};
const cached = new Map();

function loadPack(language) {
  if (!cached.has(language)) {
    const catalog = JSON.parse(readFileSync(new URL("../../src/locales/" + language + ".json", import.meta.url), "utf8"));
    const messages = Object.fromEntries(Object.entries(catalog)
      .filter(([key]) => key.startsWith("mobileChat."))
      .map(([key, value]) => [key.slice("mobileChat.".length), value]));
    for (const [key, source] of Object.entries(sharedKeys)) {
      if (Object.hasOwn(catalog, source)) messages[key] = catalog[source];
    }
    cached.set(language, messages);
  }
  return cached.get(language);
}

export function mobileCatalog(tag) {
  const locale = catalogLanguage(tag, languageNames);
  const english = loadPack("en");
  const t = catalogTranslator(loadPack(locale), english);
  const messages = Object.fromEntries(Object.keys(english).map(key => [key, t(key)]));
  return { locale, messages };
}

export function preferredMobileLanguage(header = "") {
  const preferences = header.split(",").map(part => {
    const [tag, weight] = part.trim().split(/\s*;\s*/);
    const match = weight?.match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i);
    return { tag, quality:weight === undefined ? 1 : match ? Number(match[1]) : 0 };
  }).filter(({ tag, quality }) => quality > 0 &&
    (catalogLanguage(tag, languageNames) !== "en" || /^en(?:[-_]|$)/i.test(tag)));
  return preferences.sort((left, right) => right.quality - left.quality)[0]?.tag || "en";
}

export function renderMobilePage(template, catalog) {
  // Even inert script data ends at an HTML closing script tag. Escape '<' before inserting JSON.
  const data = JSON.stringify(catalog).replaceAll("<", "\\u003c");
  const retry = catalog.messages.retry.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return template.replace('<html lang="en">', () => '<html lang="' + catalog.locale + '">')
    .replace('id="startupRetry" href="/mobile"', () => 'id="startupRetry" href="/mobile?lang=' + encodeURIComponent(catalog.locale) + '"')
    .replace("<!--mobile-retry-label-->", () => retry)
    .replace("<!--mobile-catalog-->", () => data);
}
