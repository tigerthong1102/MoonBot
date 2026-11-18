import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";
import { locales } from "../src/locales/index.ts";

const retired = /\b(?:OpenMausBot|MausBot|Mausbot)\b/;
const exceptions: Record<string, readonly string[]> = {
  "electron/cloud-sync.mjs": ["MausBot"],
  "server/extractor/contract.ts": ["OpenMausBot is checking that an extraction-model key works."],
  "server/decider/relay.ts": ["OpenMausBot is checking that a decision-model key works."],
  "electron/cloud-sync-mark.mjs": [";OpenMausBot;"],
  "electron/desktop-server-auth.cjs": ["X-OpenMausBot-Desktop-Owner"],
  "electron/open-at-login.mjs": ["X-OpenMausBot-Lending=true"],
  "server/browser-engine-release.ts": ["https://github.com/milind-soni/OpenMausBot/releases/download/browser-engine-v0.36.0-omb.1/agent-browser-win32-x64-0.36.0-omb.1.exe"],
  "server/model-manifest/manifest.ts": ["https://raw.githubusercontent.com/milind-soni/OpenMausBot/main/server/model-manifest/model-manifest.json"],
  "src/lib/computer-messages.ts": ["The existing container was not created by OpenMausBot; recreate it"],
  "packages/phone-protocol/src/startupbot-brand.ts": ["MausBot", "OpenMausBot"],
  "packages/phone-protocol/src/phone-secret-envelope.ts": ["OpenMausBot phone credential v1"],
};

describe("StartupBot product text", () => {
  it("keeps retired product names out of all locale values, preserving translation keys", () => {
    const found: string[] = [];
    for (const [locale, catalog] of Object.entries(locales)) {
      for (const [key, value] of Object.entries(catalog)) {
        if (/OpenMausBot|MausBot|Mausbot/.test(String(value))) found.push(`${locale}:${key}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("permits old names only in bounded compatibility, attribution and OSS dependency literals", () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n")
      .filter(file => (/^(?:src|server|electron|companion|relay|shared|packages\/phone-protocol\/src)\//.test(file) || file === "scripts/mcp-server.ts")
        && /\.(?:[cm]?js|tsx?)$/.test(file) && !/(?:\.test\.|\.node-test\.|\/testing\/|\/test\/|\.d\.[cm]?ts$)/.test(file));
    const found: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!retired.test(source) && !/\\[ux]/.test(source)) continue;
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
          const text = node.text;
          if (retired.test(text) && !exceptions[file]?.includes(text)) {
            const modulePath = (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node;
            const attribution = /(?:copyright|licensed under|OpenMausBot-(?:LICENSE|NOTICE))/i.test(text);
            if (!modulePath && !attribution) found.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${text}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(found).toEqual([]);
  });

  it("uses StartupBot distribution and support metadata while retaining author attribution", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.homepage).toBe("https://startupbot.ai");
    expect(pkg.repository.url).toBe("https://github.com/tigerthong1102/MoonBot.git");
    expect(pkg.desktopName).toBe("ai.startupbot.desktop");
    expect(pkg.author.name).toBe("Milind Soni");
    expect(readFileSync("src/lib/steel-body.ts", "utf8")).not.toContain("assets/mausbot-steel");
    expect(readFileSync("src/lib/analytics.ts", "utf8")).not.toContain("phc_m2hP39");
  });
});
