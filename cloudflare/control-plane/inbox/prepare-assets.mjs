import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve("brotli-wasm"));
const out = fileURLToPath(new URL("./public/brotli-3.0.1/", import.meta.url));
await mkdir(out, { recursive: true });
for (const name of ["brotli_wasm.js", "brotli_wasm_bg.wasm"]) {
  await copyFile(join(pkg, "pkg.web", name), join(out, name));
}
await copyFile(join(pkg, "LICENSE"), join(out, "LICENSE"));

const messages = {};
for (const locale of ["en", "vi"]) {
  const path = new URL("../../../src/locales/" + locale + ".json", import.meta.url);
  const catalog = JSON.parse(await readFile(path, "utf8"));
  messages[locale] = Object.fromEntries(Object.entries(catalog).filter(([key]) => key.startsWith("personalInbox.")));
}
await writeFile(new URL("./public/inbox-messages.js", import.meta.url), "export const messages = " + JSON.stringify(messages) + ";\n");

const styles = await readFile(new URL("../../../src/styles.css", import.meta.url), "utf8");
const tokens = ["--code-color-scheme", "--font-sans", ...["app", "panel", "card", "raised", "ink", "ink-secondary", "hairline", "accent-text", "focus", "bubble-user", "bubble-user-ink"].map((name) => "--color-" + name)];
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
await writeFile(new URL("./public/inbox-skins.css", import.meta.url), rules.join("\n"));
