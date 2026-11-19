import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const here = new URL("./", import.meta.url);
const [js, css] = await Promise.all([
  build({
    entryPoints: [fileURLToPath(new URL("review.jsx", here))],
    bundle: true,
    minify: true,
    write: false,
    format: "iife",
    loader: { ".png": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  readFile(new URL("review.css", here), "utf8"),
]);
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>StartupBot · Duyệt thiết kế</title><style>${css}</style></head><body><div id="root"></div><script>${js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
if (process.argv[2] === "--export") await writeFile(process.argv[3], html);
else {
  const server = createServer((req, res) => {
    if (
      !["/", "/index.html"].includes(
        new URL(req.url, "http://localhost").pathname,
      )
    ) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      })
      .end(html);
  });
  server.listen(Number(process.argv[2] || 4178), "127.0.0.1", () =>
    console.log("http://127.0.0.1:" + server.address().port),
  );
}
