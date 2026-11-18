import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = resolve(process.argv[2] ?? resolve(root, "dist/reconciliation/doi-chieu.html"));
const bundle = await build({
  absWorkingDir: root, stdin: { contents: 'import {createElement} from "react"; import {createRoot} from "react-dom/client"; import ReconcileFiles from "./src/business-reconciliation/ReconcileFiles"; createRoot(document.getElementById("app")).render(createElement(ReconcileFiles));',
    resolveDir: root }, outfile: "portable.js", jsx: "automatic", bundle: true, write: false, minify: true,
  define: { "process.env.NODE_ENV": '"production"' }, legalComments: "inline",
});
const notices = await Promise.all(["react/LICENSE", "react-dom/LICENSE", "scheduler/LICENSE", "papaparse/LICENSE", "@zip.js/zip.js/LICENSE"].map(async name => {
  let path;
  if (name === "scheduler/LICENSE") path = resolve(dirname(fileURLToPath(import.meta.resolve("react-dom"))), "../scheduler/LICENSE");
  else path = resolve(root, "node_modules", name);
  return name + "\n" + await readFile(path, "utf8");
}));
const css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text.replace(/<\/script/gi, "<\\/script");
const document = '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Đối chiếu chứng từ · StartupBot</title><style>' +
  css + '</style><body><main id="app"></main><script>' + js + '</script><template id="licenses">' +
  notices.join("\n\n").replace(/&/g, "&amp;").replace(/</g, "&lt;") + '</template></body></html>';
await mkdir(dirname(output), { recursive: true });
await writeFile(output, document);
