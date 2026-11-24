import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { installLibrarySkill, readSkillLibraryIndex, setLibrarySkillReviewState, skillLibraryEvents } from "./skill-library.ts";
import { installStartupBotSkillCatalog } from "./startupbot-skill-catalog.ts";

const auditSnapshot: Record<string, string> = JSON.parse(readFileSync("server/testing/fixtures/skill-audit-before.json", "utf8"));

function restoreAuditSnapshot(name: string, destination: string) {
  for (const [path, contents] of Object.entries(auditSnapshot)) {
    if (!path.startsWith(`${name}/`)) continue;
    const output = join(destination, path.slice(name.length + 1));
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, Buffer.from(contents, "base64"));
  }
}

it("upgrades verified audit snapshots while preserving approvals and customized folders", () => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-skill-audit-upgrade-"));
  try {
    const catalog = join(root, "catalog");
    const library = join(root, "library");
    const names = ["hyperframes", "comps-analysis", "gemini-api", "google-ads-api-mcp-setup", "byted-las-asr-pro", "byted-las-pdf-parse-doubao", "generated-ui", "producthunt", "pptx", "byted-seedance-video-generate", "byted-seedream-image-generate"];
    mkdirSync(catalog);
    for (const name of names) restoreAuditSnapshot(name, join(catalog, name));
    const entries = JSON.parse(readFileSync("skills/catalog/index.json", "utf8"))
      .filter((entry: { name: string }) => names.includes(entry.name));
    writeFileSync(join(catalog, "index.json"), JSON.stringify(entries));
    expect(installStartupBotSkillCatalog({ catalog, root: library })).toEqual({ installed: names.length, failed: [] });
    for (const name of names) expect(setLibrarySkillReviewState(name, "approved", library)).not.toHaveProperty("error");
    const customPath = join(library, "skills", "byted-las-pdf-parse-doubao", "SOURCE.md");
    const custom = readFileSync(customPath, "utf8") + "\nCustom note.\n";
    writeFileSync(customPath, custom);
    expect(installStartupBotSkillCatalog({ root: library })).toEqual({ installed: 60, failed: [] });
    const index = readSkillLibraryIndex(library);
    for (const name of names) expect(index[name].reviewState).toBe("approved");
    expect(readFileSync(join(library, "skills/comps-analysis/SKILL.md"), "utf8")).not.toContain("examples/comps_example.xlsx");
    expect(readFileSync(join(library, "skills/hyperframes/SKILL.md"), "utf8")).toContain("Offline fonts.");
    expect(index["gemini-api"].files).toContain("references/media_generation.md");
    expect(index["google-ads-api-mcp-setup"].files).toContain("references/tools.md");
    expect(index.pptx.files).toContain("scripts/slide_text.py");
    expect(index["byted-seedance-video-generate"].files).toContain("requirements.txt");
    expect(index["byted-seedream-image-generate"].files).toContain("requirements.txt");
    expect(readFileSync(join(library, "skills/byted-las-asr-pro/SKILL.md"), "utf8")).toContain("las-cli operators help las_asr_pro");
    expect(readFileSync(join(library, "skills/generated-ui/SKILL.md"), "utf8")).toContain("Qwen's incompatible `generated_ui_show` API");
    expect(readFileSync(join(library, "skills/producthunt/scripts/producthunt_api.py"), "utf8")).toContain("[redacted]");
    expect(readFileSync(customPath, "utf8")).toBe(custom);
    expect(installStartupBotSkillCatalog({ root: library })).toEqual({ installed: 0, failed: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
        if (name === "pptx") rmSync(join(catalog, name, "scripts"), { recursive: true, force: true });
      }
      cpSync(join("server/testing/fixtures/startupbot-old-skills", name), join(catalog, name), { recursive: true });
      if (name === "producthunt") {
        writeFileSync(join(catalog, name, "scripts/producthunt_api.py"), Buffer.from(auditSnapshot["producthunt/scripts/producthunt_api.py"], "base64"));
      }
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
    const lookGuide = readFileSync(join(library, "skills/hyperframes/references/look.md"), "utf8");
    expect(lookGuide).toContain("not installed preset files");
    expect(lookGuide).not.toContain("../assets/frame-presets/");
    expect(index["hyperframes-cli"].files).toContain("references/preview-render.md");
    expect(installStartupBotSkillCatalog({ root: library })).toEqual({ installed: 0, failed: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each(["hyperframes-v2", "hyperframes-v3", "hyperframes-v4", "hyperframes-v5", "hyperframes-v6"])("upgrades the earlier %s skill", (version) => {
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
    expect(readFileSync(join(library, "skills/hyperframes/SKILL.md"), "utf8")).toContain("three visually distinct beats");
    expect(readFileSync(join(library, "skills/hyperframes/SKILL.md"), "utf8")).toContain("read the complete JSON report");
    expect(readFileSync(join(library, "skills/hyperframes/SKILL.md"), "utf8")).toContain("not character animation");
    expect(readFileSync(join(library, "skills/hyperframes/references/types/launch.md"), "utf8")).toContain("Screenshot: motion preferences");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("preserves a customized HyperFrames reference during catalog upgrade", () => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-hyperframes-custom-"));
  try {
    const catalog = join(root, "old-catalog");
    const library = join(root, "library");
    mkdirSync(catalog);
    cpSync("skills/catalog/hyperframes", join(catalog, "hyperframes"), { recursive: true });
    cpSync("server/testing/fixtures/startupbot-old-skills/hyperframes-v4", join(catalog, "hyperframes"), { recursive: true });
    const entries = JSON.parse(readFileSync("skills/catalog/index.json", "utf8"))
      .filter((entry: { name: string }) => entry.name === "hyperframes");
    writeFileSync(join(catalog, "index.json"), JSON.stringify(entries));
    expect(installStartupBotSkillCatalog({ catalog, root: library })).toEqual({ installed: 1, failed: [] });
    expect(setLibrarySkillReviewState("hyperframes", "approved", library)).not.toHaveProperty("error");
    const reference = join(library, "skills/hyperframes/references/film.md");
    const custom = readFileSync(reference, "utf8") + "\nCustom instruction.\n";
    writeFileSync(reference, custom);
    expect(installStartupBotSkillCatalog({ root: library })).toEqual({ installed: 60, failed: [] });
    expect(readFileSync(reference, "utf8")).toBe(custom);
    expect(readSkillLibraryIndex(library).hyperframes.reviewState).toBe("approved");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
