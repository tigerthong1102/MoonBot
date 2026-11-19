import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const script = path.resolve("scripts/internal-build-metadata.mjs");
function fixture(run) {
  const output = mkdtempSync(path.join(tmpdir(), "startupbot-metadata-"));
  mkdirSync(path.join(output, "smoke"));
  writeFileSync(path.join(output, `StartupBot-${version}-arm64.dmg`), "metadata fixture only, not an installer");
  try { run(output); } finally { rmSync(output, { recursive: true, force: true }); }
}
const smoke = (output, status, builtVersion) => writeFileSync(path.join(output, "smoke/desktop-smoke.json"), JSON.stringify({ status, health: { version: builtVersion } }));
const generate = output => execFileSync(process.execPath, [script, output], { stdio: "pipe" });
describe("internal artifact evidence", () => {
  it("refuses a stale installer even alongside a current passing smoke", () => fixture(output => {
    smoke(output, "PASS", version);
    writeFileSync(path.join(output, "StartupBot-old-arm64.dmg"), "stale fixture");
    expect(() => generate(output)).toThrow(/Unexpected internal installer/);
    expect(existsSync(path.join(output, "build-metadata.json"))).toBe(false);
  }));
  it.each([["FAIL", version], ["PASS", "0.0.0"]])("refuses %s smoke from version %s", (status, builtVersion) => fixture(output => {
    smoke(output, status, builtVersion);
    expect(() => generate(output)).toThrow();
    expect(existsSync(path.join(output, "SHA256SUMS.txt"))).toBe(false);
  }));
  it("writes checksums only for evidence matching the current installer version", () => fixture(output => {
    smoke(output, "PASS", version);
    generate(output);
    const metadata = JSON.parse(readFileSync(path.join(output, "build-metadata.json"), "utf8"));
    expect(metadata.version).toBe(version);
    expect(metadata.artifacts).toHaveLength(1);
    expect(readFileSync(path.join(output, "SHA256SUMS.txt"), "utf8")).toContain(metadata.artifacts[0].sha256);
  }));
});
