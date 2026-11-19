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
