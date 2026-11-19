import { copyFile, mkdir } from "node:fs/promises";
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
