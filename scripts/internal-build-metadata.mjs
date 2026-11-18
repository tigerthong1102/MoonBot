import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.argv[2] ?? path.join(root, "release", "internal"));
const config = parse(readFileSync(path.join(root, "electron-builder.internal.yml"), "utf8"));
const expected = new Set([`StartupBot-${config.extraMetadata.version}-arm64.dmg`, `StartupBot-${config.extraMetadata.version}-x64.dmg`, `StartupBot-${config.extraMetadata.version}-Setup.exe`]);
const artifacts = [];
for (const file of readdirSync(output).filter(file => /\.(dmg|exe)$/.test(file)).sort()) {
  assert(expected.has(file), `Unexpected internal installer: ${file}`);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path.join(output, file))) hash.update(chunk);
  artifacts.push({ file, bytes: statSync(path.join(output, file)).size, sha256: hash.digest("hex") });
}
assert(artifacts.length, "No internal installer was built");
const metadata = {
  product: "StartupBot", version: config.extraMetadata.version,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  platform: process.platform, node: process.version, artifacts,
  updater: "disabled", publication: "GitHub Actions artifacts only; no release",
  signing: process.platform === "darwin" ? "ad-hoc, not notarized" : "unsigned",
  smoke: JSON.parse(readFileSync(path.join(output, "smoke", "desktop-smoke.json"), "utf8")),
};
assert.equal(metadata.smoke.status, "PASS", "Failed smoke must not produce approved download metadata");
assert.equal(metadata.smoke.health?.version, metadata.version, "Smoke evidence must match the installer version");
writeFileSync(path.join(output, "build-metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
writeFileSync(path.join(output, "SHA256SUMS.txt"), artifacts.map(item => `${item.sha256}  ${item.file}\n`).join(""));
console.log(JSON.stringify({ version: metadata.version, commit: metadata.commit, artifacts }, null, 2));
