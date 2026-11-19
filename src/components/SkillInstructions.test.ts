import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import catalog from "../../skills/catalog/index.json";

const skills = new URL("../../skills/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, skills), "utf8").replaceAll("\r\n", "\n");
const names = catalog.map(({ name }) => `${name}.md`).sort();
const fencedBlocks = (text: string) => text.replace(/^[ \t]+$/gm, "").match(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm) ?? [];

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
    expect(fencedBlocks(translation)).toEqual(fencedBlocks(original));
    expect(translation.split("\n").filter(Boolean).length).toBeGreaterThan(2);
  }
});
