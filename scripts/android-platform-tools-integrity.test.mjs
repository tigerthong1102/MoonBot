import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { platformToolsPin, verifyPlatformToolsArchive, verifyPlatformToolsTree } from "./android-platform-tools-integrity.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

test("selects versioned archives and rejects altered archive bytes", () => {
  for (const [platform, suffix] of [["win32", "win"], ["darwin", "darwin"], ["linux", "linux"]]) {
    const pin = platformToolsPin(platform);
    assert.equal(pin.url, `https://dl.google.com/android/repository/platform-tools_r37.0.1-${suffix}.zip`);
    assert.match(pin.treeHash, /^[a-f0-9]{64}$/);
    assert.throws(() => verifyPlatformToolsArchive(Buffer.from("mismatch"), pin.archiveHash), /SHA-256 mismatch/);
  }
  assert.throws(() => platformToolsPin("unsupported"), /unsupported/);
});

test("offline source must contain the approved filenames and contents", () => {
  const root = mkdtempSync(join(tmpdir(), "platform-tools-integrity-"));
  try {
    const expected = digest("adb\0" + digest("fixture") + "\n");
    writeFileSync(join(root, "adb"), "fixture");
    verifyPlatformToolsTree(root, expected);
    writeFileSync(join(root, "adb"), "changed");
    assert.throws(() => verifyPlatformToolsTree(root, expected), /inventory SHA-256 mismatch/);
    writeFileSync(join(root, "adb"), "fixture");
    writeFileSync(join(root, "extra"), "unexpected");
    assert.throws(() => verifyPlatformToolsTree(root, expected), /inventory SHA-256 mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
