import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url));

describe("StartupBot distribution branding", () => {
  it("retains the exact artwork supplied by the owner", () => {
    expect(createHash("sha256").update(read("branding/startupbot-original.png")).digest("hex"))
      .toBe("50cbd625f00cebbd62a565be45897b1ef0f365a2b12472d298e42faf840bc310");
  });

  const expectPng = (bytes, size) => {
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
    expect(bytes[25]).toBe(6);
    const idat = [];
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") idat.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    expect(inflateSync(Buffer.concat(idat))[4]).toBe(0);
  };

  it.each([
    ["build/startupbot.png", 512], ["build/icon-1024.png", 1024],
    ["public/startupbot-icon-180.png", 180], ["public/startupbot-icon-192.png", 192],
    ["public/startupbot-icon-512.png", 512], ["electron/resources/startupbot-icon.png", 512],
    ...[40, 56, 88, 128, 192, 256].map(size => [`src/assets/startupbot/cursor-${size}.png`, size]),
  ])("gives %s its declared resolution and transparent outer corner", (file, size) => expectPng(read(file), size));

  it("stores correctly sized images in the native macOS and Windows icon containers", () => {
    const icns = read("build/startupbot.icns");
    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const dimensions = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
    for (let offset = 8; offset < icns.length;) {
      const length = icns.readUInt32BE(offset + 4);
      expectPng(icns.subarray(offset + 8, offset + length), dimensions[icns.toString("ascii", offset, offset + 4)]);
      offset += length;
    }
    const ico = read("build/startupbot.ico");
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(6);
    for (let entry = 6; entry < 6 + 16 * 6; entry += 16) {
      const offset = ico.readUInt32LE(entry + 12);
      expectPng(ico.subarray(offset, offset + ico.readUInt32LE(entry + 8)), ico[entry] || 256);
    }
  });
  it.each([
    ["electron/resources/app-icon.png", "electron/resources/startupbot-icon.png"],
    ["public/app-icon-192.png", "public/startupbot-icon-192.png"],
    ["public/app-icon-512.png", "public/startupbot-icon-512.png"],
    ["public/apple-touch-icon.png", "public/startupbot-icon-180.png"],
    ["build/icon.icns", "build/startupbot.icns"],
    ["build/icon.ico", "build/startupbot.ico"],
  ])("keeps %s on the approved StartupBot logo", (distributed, approved) => {
    expect(read(distributed)).toEqual(read(approved));
  });

  it.each(["public/app-icon.svg", "build/icon.svg"])("keeps the legacy SVG entry %s free of upstream mascot artwork", (file) => {
    const svg = read(file).toString();
    expect(svg).toContain("<title id=\"title\">StartupBot</title>");
    expect(svg).toContain("<image href=\"startupbot");
    expect(svg).not.toMatch(/OpenMausBot|SupaMaus|<path\b/);
  });

  it("keeps active installed-package smokes on the builder's installation root", () => {
    const builder = parse(read("electron-builder.yml").toString());
    const root = `/opt/${builder.productName}`;
    expect(read(".github/workflows/package-linux.yml").toString()).not.toContain("release/OpenMausBot");
    expect(builder.productName).toBe("StartupBot");
    expect(builder.appId).toBe("ai.startupbot.desktop");
    for (const workflow of [".github/workflows/ci.yml", ".github/workflows/package-linux.yml"]) {
      expect(read(workflow).toString()).toContain(`scripts/smoke-browser-bundle.mjs --resources ${root}/resources`);
    }
    for (const script of ["scripts/run-linux-package-smoke.mjs", "scripts/smoke-deb-command.mjs"]) {
      expect(read(script).toString()).toContain(`${root}/${builder.linux.executableName}`);
    }
  });

  it("does not advertise upstream installers as StartupBot downloads", () => {
    const readme = read("README.md").toString();
    expect(readme).not.toMatch(/github\.com\/milind-soni\/OpenMausBot\/releases\/latest\/download\//);
    expect(readme).not.toContain('src="docs/screenshots/hero.png"');
    expect(readme).toContain("No public StartupBot download is available");
    expect(readme).toContain("StartupBot is an open-source fork of [OpenMausBot]");
  });
});
