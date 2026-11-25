import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import catalog from "../../skills/catalog/index.json";

const skills = new URL("../../skills/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, skills), "utf8").replaceAll("\r\n", "\n");
const names = catalog.map(({ name }) => `${name}.md`).sort();
const fencedBlocks = (text: string) => text.replace(/^[ \t]+$/gm, "").match(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm) ?? [];
const reviewedUpdates = new Set(["xlsx", "docx", "pptx", "web-perf", "hyperframes", "hyperframes-cli", "gemini-api", "apify-ecommerce", "byted-text-to-speech", "producthunt"]);

it("includes a complete, matching set of Vietnamese and Chinese translations for the catalog", () => {
  for (const locale of ["vi", "zh", "zh-tw"]) {
    expect(readdirSync(new URL(`catalog-locales/${locale}/`, skills)).sort()).toEqual(names);
  }
  expect(readdirSync(new URL("catalog-locales/en/", skills)).sort()).toEqual(["chengfeng-cut.md", "chengfeng-subtitle.md"]);
});

it.each(catalog)("$name has localized guides pinned to the reviewed original", (entry) => {
  const original = read(`catalog/${entry.name}/SKILL.md`);
  expect(createHash("sha256").update(original).digest("hex")).toBe(entry.instructionsSha256);
  const locales = ["vi", "zh", "zh-tw", ...(entry.summaryEn ? ["en"] : [])];
  expect(entry.summaryVi.length).toBeGreaterThan(4);
  expect(entry.summaryZh).toMatch(/\p{Script=Han}/u);
  expect(entry.summaryZhTw).toMatch(/\p{Script=Han}/u);
  for (const locale of locales) {
    const translation = read(`catalog-locales/${locale}/${entry.name}.md`);
    expect(translation).not.toMatch(/\[ZX\d+QZ\]/);
    if (["chengfeng-cut", "chengfeng-subtitle"].includes(entry.name) && ["vi", "en"].includes(locale)) {
      const sourceBlocks = fencedBlocks(original), translatedBlocks = fencedBlocks(translation);
      expect(translation.replace(/`[^`\n]+`/g, "")).not.toMatch(/\p{Script=Han}/u);
      expect(translation).not.toMatch(/call the police|gọi cảnh sát/i);
      expect(translatedBlocks).toHaveLength(sourceBlocks.length);
      for (let i = 0; i < sourceBlocks.length; i++) {
        const source = sourceBlocks[i], translated = translatedBlocks[i];
        if (source.startsWith("```text\n")) {
          expect(translated.startsWith("```text\n")).toBe(true);
          expect(translated.split("\n")).toHaveLength(source.split("\n").length);
          expect(translated).not.toMatch(/\p{Script=Han}/u);
        } else if (source.startsWith("```bash\n")) {
          const placeholders: Record<string, string> = {
            PLUGIN_ROOT: "插件根", PROJECT_DIR: "项目目录", TASK_VIDEO: "任务目录内的视频文件",
            TASK_TRANSCRIPT: "任务目录内的逐词稿", SCRIPT_FILE: "口播稿文件", CORRECTIONS_FILE: "修正文件",
            PROPOSAL_FILE: "提案文件", CUTS_REVISION: "Cuts当前revision", PROJECT_URL: "产品项目URL",
          };
          const commands = (block: string) => block.split("\n").slice(1, -1)
            .map(line => line.replace(/\s*#.*$/, "").replace(/<([A-Z_]+)>/g, (match, key: string) => placeholders[key] ? `<${placeholders[key]}>` : match).trim())
            .filter(Boolean);
          expect(commands(translated)).toEqual(commands(source));
        } else {
          expect(translated).toBe(source);
        }
      }
    } else {
      expect(fencedBlocks(translation)).toEqual(fencedBlocks(original));
    }
    if (entry.name === "chengfeng-cut" && locale === "en") {
      expect(translation).toContain("do not substitute examples or placeholder video");
    }
    expect(translation.split("\n").filter(Boolean).length).toBeGreaterThan(2);
    if (reviewedUpdates.has(entry.name)) {
      const tokens: string[] = translation.match(/`[^`\n]+`/g) ?? [];
      for (const token of original.match(/`[^`\n]+`/g) ?? []) {
        const index = tokens.indexOf(token);
        expect(index, `${locale}: missing ${token}`).toBeGreaterThanOrEqual(0);
        tokens.splice(index, 1);
      }
    }
  }
});
