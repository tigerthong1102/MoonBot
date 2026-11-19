import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("customer installers", () => {
  it("requires platform signing and keeps customer builds distinct from internal builds", () => {
    const customer = parse(readFileSync("electron-builder.customer.yml", "utf8"));
    expect(customer.extends).toBe("./electron-builder.yml");
    expect(customer.forceCodeSigning).toBe(true);
    expect(customer.dmg.sign).toBe(true);
    expect(customer.mac.identity).not.toBe("-");
    expect(customer.extraMetadata.name).toBe("startupbot");
    expect(customer.extraMetadata.version).toBeUndefined();
    const { version } = JSON.parse(readFileSync("package.json", "utf8"));
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("leaves Android Platform Tools to the user on macOS and Windows", () => {
    const base = parse(readFileSync("electron-builder.yml", "utf8"));
    for (const platform of [base, base.mac, base.win]) {
      expect(platform.extraResources).not.toContainEqual(expect.objectContaining({ to: "android-platform-tools" }));
    }
    expect(base.linux.extraResources).toContainEqual(expect.objectContaining({ to: "android-platform-tools" }));
  });

  it.skipIf(process.platform !== "darwin")("rejects an intact unsigned DMG", () => {
    const fixture = mkdtempSync(join(tmpdir(), "startupbot-signing-"));
    try {
      const source = join(fixture, "source");
      mkdirSync(source);
      writeFileSync(join(source, "example.txt"), "unsigned fixture");
      const dmg = join(fixture, "example.dmg");
      execFileSync("hdiutil", ["create", "-quiet", "-size", "8m", "-fs", "HFS+", "-srcfolder", source, dmg]);
      execFileSync("hdiutil", ["verify", dmg], { stdio: "ignore" });
      const result = spawnSync("bash", ["scripts/customer-mac.sh", "verify", dmg, "AB12345678"], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/not signed/i);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);

  it.skipIf(process.platform !== "win32")("rejects an EXE without the publisher signature", () => {
    const fixture = mkdtempSync(join(tmpdir(), "startupbot-signing-"));
    try {
      const file = join(fixture, "StartupBot-setup.exe");
      writeFileSync(file, "unsigned fixture");
      const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", "scripts/customer-windows.ps1", "verify", "-Thumbprint", "A".repeat(40), "-Installer", file], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Expected a trusted signature");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);
});
