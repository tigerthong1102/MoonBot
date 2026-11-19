import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { installLibrarySkill, readSkillLibraryIndex, setLibrarySkillReviewState } from "./skill-library.ts";
import { installStartupBotSkillCatalog } from "./startupbot-skill-catalog.ts";

it("stages the catalog with notices and preserves existing library choices on restart", () => {
  const root = mkdtempSync(join(tmpdir(), "startupbot-skill-catalog-"));
  try {
    const instructions = "---\nname: pdf\ndescription: My existing PDF skill.\n---\n\nMy local instructions.\n";
    expect(installLibrarySkill({ root, name: "pdf", instructions, source: "local-import" })).not.toHaveProperty("error");
    expect(installStartupBotSkillCatalog({ root })).toEqual({ installed: 60, failed: [] });
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
