/** Resolve a browser or native locale against the registered app packs. */
export function catalogLanguage(tag, packs) {
  const parts = String(tag || "").toLowerCase().replaceAll("_", "-").split("-");
  if (parts[0] === "pt") return "pt-br";
  if (parts[0] === "zh" && parts.some(part => ["hant", "hk", "tw", "mo"].includes(part))) return "zh-tw";
  return Object.hasOwn(packs, parts[0]) ? parts[0] : "en";
}

export function catalogTranslator(pack, english) {
  return function t(key, values = {}) {
    const template = Object.hasOwn(pack, key) ? pack[key] : Object.hasOwn(english, key) ? english[key] : undefined;
    return template?.replace(/\{(\w+)\}/g, (placeholder, name) => values[name] ?? placeholder);
  };
}
