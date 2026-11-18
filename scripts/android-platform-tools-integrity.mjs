// Source: https://dl.google.com/android/repository/repository2-3.xml (platform-tools, 37.0.1).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const pins = {
  darwin: ["darwin", "ee39ad5967e95c2a07f04dbcbde96b1a0c916ba376096db5d2f498b7727a5d1d", "c3a67643665e720a564cad37f0220e5521d09244f5438940cd2140fad275f0b7"],
  linux: ["linux", "d230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1", "8d2ec933aeed9c8b32a729236df981f0ee0970d2d79ae54626e52f051a1a9be0"],
  win32: ["win", "45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99", "d667091e97d22478d72779fe524354950719736a8dda4eabeb24302568ef4a5c"],
};

export function platformToolsPin(platform) {
  if (!Object.hasOwn(pins, platform)) throw new Error(`Android Platform Tools are unsupported on ${platform}`);
  const [suffix, archiveHash, treeHash] = pins[platform];
  return { url: `https://dl.google.com/android/repository/platform-tools_r37.0.1-${suffix}.zip`, archiveHash, treeHash };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyPlatformToolsArchive(bytes, expected) {
  if (sha256(bytes) !== expected) throw new Error("Android Platform Tools archive SHA-256 mismatch");
}

export function verifyPlatformToolsTree(root, expected) {
  const records = [];
  function visit(dir, prefix) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const relative = prefix + entry.name;
      if (entry.isDirectory()) visit(path, relative + "/");
      else if (entry.isFile()) records.push(relative + "\0" + sha256(readFileSync(path)) + "\n");
      else throw new Error("Unexpected link or special file in Android Platform Tools");
    }
  }
  visit(root, "");
  if (sha256(records.sort().join("")) !== expected) throw new Error("Android Platform Tools file inventory SHA-256 mismatch");
}
