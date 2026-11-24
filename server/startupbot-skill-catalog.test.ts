import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { installLibrarySkill, readSkillLibraryIndex, setLibrarySkillReviewState, skillLibraryEvents } from "./skill-library.ts";
import { installStartupBotSkillCatalog } from "./startupbot-skill-catalog.ts";

it("stages the catalog with notices and preserves existing library choices on restart", () => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-skill-catalog-"));
  try {
    const instructions = "---\nname: pdf\ndescription: My existing PDF skill.\n---\n\nMy local instructions.\n";
    expect(installLibrarySkill({ root, name: "pdf", instructions, source: "local-import" })).not.toHaveProperty("error");
    const publishedSizes: number[] = [];
    const onInstall = () => publishedSizes.push(Object.keys(readSkillLibraryIndex(root)).length);
    skillLibraryEvents.on("invalidate", onInstall);
    try {
      expect(installStartupBotSkillCatalog({ root })).toEqual({ installed: 60, failed: [] });
    } finally {
      skillLibraryEvents.off("invalidate", onInstall);
    }
    expect(publishedSizes).toHaveLength(60);
    expect(new Set(publishedSizes)).toEqual(new Set([61]));
    const index = readSkillLibraryIndex(root);
    expect(Object.keys(index)).toHaveLength(61);
    expect(index.pdf?.source).toBe("local-import");
    expect(Object.values(index).every((entry) => entry.reviewState === "disabled" && !entry.everyBot)).toBe(true);
    for (const entry of Object.values(index).filter(({ name }) => name !== "pdf")) {
      expect(entry.license).toBe("Apache-2.0");
      expect(entry.description.length).toBeGreaterThan(8);
      expect(entry.files).toEqual(expect.arrayContaining(["LICENSE", "SOURCE.md"]));
      expect(readFileSync(join(root, "skills", entry.name, "LICENSE"), "utf8")).toContain("4. Redistribution");
    }
    expect(setLibrarySkillReviewState("xlsx", "approved", root)).not.toHaveProperty("error");
    expect(installStartupBotSkillCatalog({ root })).toEqual({ installed: 0, failed: [] });
    expect(readSkillLibraryIndex(root).xlsx?.reviewState).toBe("approved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("upgrades original catalog folders and keeps their review choices", () => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-hyperframes-upgrade-"));
  try {
    const catalog = join(root, "old-catalog");
    const library = join(root, "library");
    mkdirSync(catalog);
    const names = ["hyperframes", "hyperframes-cli", "web-perf", "xlsx", "docx", "pptx", "producthunt", "apify-ecommerce", "gemini-api", "byted-text-to-speech"];
    const entries = JSON.parse(readFileSync("skills/catalog/index.json", "utf8"))
      .filter((entry: { name: string }) => names.includes(entry.name));
    writeFileSync(join(catalog, "index.json"), JSON.stringify(entries));
    for (const name of names) {
      if (["xlsx", "docx", "pptx", "producthunt", "apify-ecommerce", "gemini-api", "byted-text-to-speech"].includes(name)) {
        cpSync(join("skills/catalog", name), join(catalog, name), { recursive: true });
        rmSync(join(catalog, name, "references"), { recursive: true, force: true });
      }
      cpSync(join("server/testing/fixtures/startupbot-old-skills", name), join(catalog, name), { recursive: true });
    }
    expect(installStartupBotSkillCatalog({ catalog, root: library })).toEqual({ installed: 10, failed: [] });
    expect(setLibrarySkillReviewState("hyperframes", "approved", library)).not.toHaveProperty("error");
    expect(setLibrarySkillReviewState("web-perf", "approved", library)).not.toHaveProperty("error");
    expect(setLibrarySkillReviewState("xlsx", "approved", library)).not.toHaveProperty("error");
    expect(setLibrarySkillReviewState("docx", "approved", library)).not.toHaveProperty("error");
    expect(setLibrarySkillReviewState("gemini-api", "approved", library)).not.toHaveProperty("error");
    expect(setLibrarySkillReviewState("byted-text-to-speech", "approved", library)).not.toHaveProperty("error");

    expect(installStartupBotSkillCatalog({ root: library })).toEqual({ installed: 61, failed: [] });
    const index = readSkillLibraryIndex(library);
    expect(index.hyperframes.reviewState).toBe("approved");
    expect(index["hyperframes-cli"].reviewState).toBe("disabled");
    expect(index["web-perf"].reviewState).toBe("approved");
    expect(index.xlsx.reviewState).toBe("approved");
    expect(index.docx.reviewState).toBe("approved");
    expect(index.pptx.reviewState).toBe("disabled");
    expect(index["gemini-api"].reviewState).toBe("approved");
    expect(index["apify-ecommerce"].reviewState).toBe("disabled");
    expect(index["byted-text-to-speech"].reviewState).toBe("approved");
    expect(readFileSync(join(library, "skills/byted-text-to-speech/SKILL.md"), "utf8")).toContain("system speech synthesizer");
    expect(readFileSync(join(library, "skills/gemini-api/SKILL.md"), "utf8")).toContain("structured output");
    expect(index.docx.files).toContain("references/upstream.md");
    expect(index.pptx.files).toContain("references/upstream.md");
    expect(readFileSync(join(library, "skills/web-perf/SKILL.md"), "utf8")).toContain("Performance Trace");
    expect(index.hyperframes.files).toContain("references/format.md");
    const filmGuide = readFileSync(join(library, "skills/hyperframes/references/film.md"), "utf8");
    expect(filmGuide).toContain("user-provided image or video");
    expect(filmGuide).not.toMatch(/scripts\/(?:bake-basemap|locate)\.mjs/);
    expect(index["hyperframes-cli"].files).toContain("references/preview-render.md");
    expect(installStartupBotSkillCatalog({ root: library })).toEqual({ installed: 0, failed: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each(["hyperframes-v2", "hyperframes-v3"])("upgrades the earlier %s skill", (version) => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-hyperframes-upgrade-"));
  try {
    const catalog = join(root, "old-catalog");
    const library = join(root, "library");
    const oldSkill = join(catalog, "hyperframes");
    mkdirSync(catalog);
    cpSync("skills/catalog/hyperframes", oldSkill, { recursive: true });
    cpSync(join("server/testing/fixtures/startupbot-old-skills", version), oldSkill, { recursive: true });
    const entries = JSON.parse(readFileSync("skills/catalog/index.json", "utf8"))
      .filter((entry: { name: string }) => entry.name === "hyperframes");
    writeFileSync(join(catalog, "index.json"), JSON.stringify(entries));
    expect(installStartupBotSkillCatalog({ catalog, root: library })).toEqual({ installed: 1, failed: [] });
    expect(setLibrarySkillReviewState("hyperframes", "approved", library)).not.toHaveProperty("error");
    expect(installStartupBotSkillCatalog({ root: library })).toEqual({ installed: 61, failed: [] });
    expect(readSkillLibraryIndex(library).hyperframes.reviewState).toBe("approved");
    expect(readFileSync(join(library, "skills/hyperframes/SKILL.md"), "utf8")).toContain("compact shot plan");
    expect(readFileSync(join(library, "skills/hyperframes/references/types/launch.md"), "utf8")).toContain("Screenshot: motion preferences");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
