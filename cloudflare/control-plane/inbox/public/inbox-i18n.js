import { messages } from "./inbox-messages.js";

const normalize = (tag) => /^vi(?:-|$)/i.test(tag) ? "vi" : "en";
const url = new URL(location.href);
export let language = normalize(new URLSearchParams(url.hash.slice(1)).get("lang") || url.searchParams.get("lang") || navigator.language);

export function t(key, values = {}) {
  return messages[language][key].replace(/\{(\w+)\}/g, (placeholder, name) => values[name] ?? placeholder);
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
