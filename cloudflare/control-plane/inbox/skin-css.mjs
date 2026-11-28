export function inboxSkinCSS(styles) {
  const tokens = ["--code-color-scheme", "--font-sans", "--font-mono", ...["sm", "md", "lg", "xl", "4xl"].map(size => "--radius-" + size), ...["control", "raised-hover", "menu", "menu-hover", "accent", "accent-ink", "app", "panel", "card", "raised", "ink", "ink-secondary", "hairline", "accent-text", "focus", "bubble-user", "bubble-user-ink"].map((name) => "--color-" + name)];
  const defaults = styles.match(/@theme\s*\{([^}]+)\}/)?.[1] ?? "";
  const skins = new Map();
  for (const [, skin, declarations] of styles.matchAll(/^\[data-skin="([a-z-]+)"\] \{([^}]+)\}/gm)) {
    const values = new Map(Array.from(declarations.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), ([, key, value]) => [key, value.trim()]));
    skins.set(skin, tokens.map((key) => {
      const value = values.get(key) ?? defaults.match(new RegExp(key + ":\\s*([^;]+);"))?.[1];
      if (!value) throw new Error("Missing inbox skin token " + skin + " " + key);
      return key + ":" + value + ";";
    }).join("\n"));
  }
  if (!skins.has("daylight") || !skins.has("midnight")) throw new Error("Missing reference inbox skins");
  const rules = [":root{" + skins.get("daylight") + "}", "@media (prefers-color-scheme:dark){:root{" + skins.get("midnight") + "}}"];
  for (const [skin, body] of skins) rules.push(':root[data-skin="' + skin + '"]{' + body + "}");
  for (const [, media, body] of styles.matchAll(/^@media ([^{]+)\{([\s\S]*?)^\}/gm)) {
    const overrides = [];
    for (const [, skin, declarations] of body.matchAll(/:is\(\[data-skin="([a-z-]+)"\]\)\s*\{([^}]+)\}/g)) {
      const values = Array.from(declarations.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
        .filter(([, key]) => tokens.includes(key)).map(([, key, value]) => key + ":" + value + ";");
      if (values.length) overrides.push(':root[data-skin="' + skin + '"]{' + values.join("") + "}");
    }
    if (overrides.length) rules.push("@media " + media + "{" + overrides.join("\n") + "}");
  }
  const components = styles.match(/^@layer components \{[\s\S]*?^\}/m)?.[0];
  if (!components?.includes(".ui-icon-button")) throw new Error("Missing shared control recipes");
  rules.push(components);
  return rules.join("\n");
}
