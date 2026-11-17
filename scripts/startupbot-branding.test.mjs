import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url));

describe("StartupBot distribution branding", () => {
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

  it("does not advertise upstream installers as StartupBot downloads", () => {
    const readme = read("README.md").toString();
    expect(readme).not.toMatch(/github\.com\/milind-soni\/OpenMausBot\/releases\/latest\/download\//);
    expect(readme).not.toContain('src="docs/screenshots/hero.png"');
    expect(readme).toContain("No public StartupBot download is available");
    expect(readme).toContain("StartupBot is an open-source fork of [OpenMausBot]");
  });
});
