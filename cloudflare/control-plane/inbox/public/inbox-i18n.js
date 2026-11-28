import { messages, languageNames } from "./inbox-messages.js";
import { catalogLanguage, catalogTranslator } from "./catalog-i18n.js";

export { languageNames };
const url = new URL(location.href);
export let language = catalogLanguage(new URLSearchParams(url.hash.slice(1)).get("lang") || url.searchParams.get("lang") || navigator.language, messages);
let translate = catalogTranslator(messages[language], messages.en);

export function t(key, values = {}) {
  return translate(key, values);
}

export function setLanguage(tag) {
  language = catalogLanguage(tag, messages);
  translate = catalogTranslator(messages[language], messages.en);
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
