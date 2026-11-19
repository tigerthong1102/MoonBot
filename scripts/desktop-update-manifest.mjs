import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import source from "../electron/desktop-update-source.cjs";

const [dir, platform, arch] = process.argv.slice(2);
if (!["darwin", "win32"].includes(platform)) throw new Error("Unsupported update platform");
const expected = source.updateFeed(arch);
const { channel } = expected;
const resources = platform === "darwin" ? join(dir, "zip-verify", "StartupBot.app", "Contents", "Resources") : join(dir, arch === "x64" ? "win-unpacked" : "win-arm64-unpacked", "resources");
const installed = parse(await readFile(join(resources, "app-update.yml"), "utf8"));
if (Object.keys(expected).some(key => installed[key] !== expected[key])) throw new Error("Packaged update source differs from the release channel");
if (platform === "win32") {
  const publishers = [installed.publisherName].flat();
  if (!process.env.STARTUPBOT_SIGNED_PUBLISHER || publishers.length !== 1 || publishers[0] !== process.env.STARTUPBOT_SIGNED_PUBLISHER) {
    throw new Error("Packaged publisher differs from the signing certificate");
  }
}
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const file = `StartupBot-${version}-${arch}${platform === "darwin" ? ".zip" : "-setup.exe"}`;
const manifest = join(dir, `${channel}${platform === "darwin" ? "-mac" : ""}.yml`);
const info = parse(await readFile(manifest, "utf8"));
const candidates = info.files.filter(entry => entry.url === file);
if (info.version !== version || candidates.length !== 1) throw new Error("Unexpected update version or artifact");
const [entry] = candidates;
const payload = join(dir, file);
const hash = createHash("sha512");
for await (const chunk of createReadStream(payload)) hash.update(chunk);
if (entry.sha512 !== hash.digest("base64") || entry.size !== (await stat(payload)).size) {
  throw new Error("Update manifest does not match the signed artifact");
}
await writeFile(manifest, stringify({ ...info, files: [entry], path: file, sha512: entry.sha512 }));
