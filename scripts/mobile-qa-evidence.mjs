// An offline receipt for the app and screenshot from one disposable mobile QA run.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: Object.fromEntries(
  ["platform", "device", "runtime", "build", "directory", "revision"].map(name => [name, { type: "string" }])
) });
const { platform, device, runtime, build, directory, revision } = values;
if (!["ios", "android"].includes(platform) || !device || !runtime || !build || !directory || !revision) {
  throw new Error("Provide --platform (ios/android), --device, --runtime, --build, --directory and --revision.");
}
const imageName = `startupbot-${platform}.png`;
const image = await readFile(join(directory, imageName));
if (image.length < 24 || !image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
  throw new Error("The simulator screenshot is missing or invalid.");
}
const buildHash = createHash("sha256");
for await (const chunk of createReadStream(build)) buildHash.update(chunk);
const smoke = JSON.parse(await readFile(join(directory, "smoke.json"), "utf8"));
if (smoke.status !== "PASS") throw new Error("The mobile smoke check has not passed.");
const receipt = {
  platform, device, runtime, revision, testedAt: new Date().toISOString(),
  build: { file: basename(build), sha256: buildHash.digest("hex") },
  screenshot: { file: imageName, width: image.readUInt32BE(16), height: image.readUInt32BE(20),
    sha256: createHash("sha256").update(image).digest("hex") },
  smoke,
};
await writeFile(join(directory, "evidence.json"), JSON.stringify(receipt, null, 2) + "\n");
const escape = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const references = platform === "android" ? [["ui.xml", "Accessibility tree"], ["launch.txt", "Launch log"]] : [["installation.json", "Installed bundle identity"], ["launch.txt", "Launch log"]];
const rows = Object.entries({ Device: device, Runtime: runtime, Revision: revision, Build: basename(build), "Build SHA-256": receipt.build.sha256, Tested: receipt.testedAt, Scope: smoke.scope });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StartupBot · ${platform} QA</title>
<style>body{font:1rem/1.55 system-ui;margin:2rem auto;padding:0 1rem;max-width:72rem;color:#192524}main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2rem}img{max-width:100%;max-height:78vh;object-fit:contain}dt{font-weight:bold}dd{margin:0 0 1rem;overflow-wrap:anywhere}@media(max-width:44rem){main{display:block}}</style>
<h1>StartupBot · ${platform === "ios" ? "iOS Simulator" : "Android Emulator"}</h1>
<main><a href="${imageName}"><img src="${imageName}" alt="StartupBot screen on the tested device"></a><section><dl>${rows.map(([k,v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join("")}</dl>
<ul>${[["evidence.json","Machine-readable receipt"], ...references].map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("")}</ul></section></main></html>`;
await writeFile(join(directory, "index.html"), html);
