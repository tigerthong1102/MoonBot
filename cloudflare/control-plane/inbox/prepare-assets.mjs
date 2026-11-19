import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Paperclip, Send, FileText, Download, Users, Search, SquarePen, Ellipsis, X, MessageCircle, Info } from "lucide-react";
import { createServer } from "vite";
import { build } from "esbuild";
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
const mail = {};
const mailKeys = ["emailSubject", "emailIntro", "emailOpen", "emailStop", "otpSubject", "otpBody"];
const languageNames = JSON.parse(await readFile(new URL("../../../shared/app-language-names.json", import.meta.url), "utf8"));
for (const locale of Object.keys(languageNames)) {
  const path = new URL("../../../src/locales/" + locale + ".json", import.meta.url);
  const catalog = JSON.parse(await readFile(path, "utf8"));
  mail[locale] = Object.fromEntries(mailKeys.map(key => {
    const value = catalog["personalInbox." + key];
    if (!value?.trim()) throw new Error("Missing inbox email text for " + locale + ": " + key);
    return [key, value];
  }));
  messages[locale] = Object.fromEntries(Object.entries(catalog).filter(([key]) =>
    key.startsWith("personalInbox.") && !mailKeys.includes(key.slice("personalInbox.".length))));

}
const mailPath = new URL("../src/inbox-mail-text.json", import.meta.url);
const mailContents = JSON.stringify(mail, null, 2) + "\n";
if (await readFile(mailPath, "utf8").catch(() => "") !== mailContents) await writeFile(mailPath, mailContents);

const root = fileURLToPath(new URL("../../../", import.meta.url));
await build({
  entryPoints: [join(root, "src/lib/clipboard-write.ts")],
  outfile: fileURLToPath(new URL("./public/inbox-copy-text.js", import.meta.url)),
  format: "esm", platform: "browser", bundle: true,
});
const vite = await createServer({
  root, configFile: false, appType: "custom", logLevel: "error",
  resolve: { alias: { "@": join(root,"src") } },
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
let selectMarkup;
try {
  const { Select } = await vite.ssrLoadModule("/src/components/Select.tsx");
  selectMarkup = renderToStaticMarkup(createElement(Select, { size:"sm" }));
} finally {
  await vite.close();
}
await writeFile(new URL("./public/inbox-messages.js", import.meta.url), [
  ["messages", messages], ["languageNames", languageNames], ["selectMarkup", selectMarkup],
].map(([name, value]) => "export const " + name + " = " + JSON.stringify(value) + ";").join("\n") + "\n");


const icons = { clip: Paperclip, send: Send, file: FileText, down: Download, group: Users, search: Search, new: SquarePen, more: Ellipsis, close: X, chat: MessageCircle, info: Info };
const symbols = Object.entries(icons).map(([name, Icon]) => {
  const svg = renderToStaticMarkup(createElement(Icon));
  return svg.replace(/^<svg[^>]*>/, '<symbol id="i-' + name + '" viewBox="0 0 24 24">').replace(/<\/svg>$/, "</symbol>");
});
await writeFile(new URL("./public/inbox-icons.svg", import.meta.url), '<svg xmlns="http://www.w3.org/2000/svg">' + symbols.join("") + "</svg>\n");

const styles = await readFile(new URL("../../../src/styles.css", import.meta.url), "utf8");
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
await writeFile(new URL("./public/inbox-skins.css", import.meta.url), rules.join("\n"));
