import { messages, languageNames } from "./inbox-messages.js";

export { languageNames };
function normalize(tag) {
  const parts = String(tag || "").toLowerCase().replaceAll("_", "-").split("-");
  if (parts[0] === "pt") return "pt-br";
  if (parts[0] === "zh" && parts.some(p => ["hant","hk","tw","mo"].includes(p))) return "zh-tw";
  return Object.hasOwn(messages, parts[0]) ? parts[0] : "en";
}
const url = new URL(location.href);
export let language = normalize(new URLSearchParams(url.hash.slice(1)).get("lang") || url.searchParams.get("lang") || navigator.language);

export function t(key, values = {}) {
  return (messages[language][key] ?? messages.en[key]).replace(/\{(\w+)\}/g, (placeholder, name) => values[name] ?? placeholder);
}

export function setLanguage(tag) {
  language = normalize(tag);
  document.documentElement.lang = language;
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const attribute of ["title", "aria-label", "placeholder"]) {
    const key = "data-i18n-" + attribute;
    for (const element of document.querySelectorAll("[" + key + "]")) {
      element.setAttribute(attribute, t(element.getAttribute(key)));
    }
  }
}
