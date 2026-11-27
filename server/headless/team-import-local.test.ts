import { expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reviewOpenClaw } from "./team-import-local.ts";
import { loadTeamFile } from "./team-file.ts";

it("stages only selected bot documents, validates the actual team file and never replaces an existing output", () => {
  const root = mkdtempSync(join(tmpdir(), "omb-openclaw-"));
  try {
    const source = join(root, "source"), skill = join(source, "skills", "brief");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(source, "IDENTITY.md"), "- **Name:** Scout\n");
    writeFileSync(join(source, "SOUL.md"), "Keep summaries short.");
    writeFileSync(join(source, "openclaw.json"), "private credentials");
    writeFileSync(join(skill, "SKILL.md"), "---\nname: brief\ndescription: Make a brief.\n---\nSummarize.\n");
    const preview = reviewOpenClaw(source, join(root, "preview"), true);
    const bot = loadTeamFile(preview.manifest).bots[0]!;
    expect(bot).toMatchObject({ name: "Scout", soul: "Keep summaries short.", skills: [{ name: "brief", enabled: false }] });
    expect(() => reviewOpenClaw(source, join(root, "preview"), true)).toThrow();
    expect(readFileSync(preview.manifest, "utf8")).not.toContain("private credentials");
    expect(reviewOpenClaw(source, join(root, "profile"), false).skills).toBe(0);
    writeFileSync(join(skill, "SKILL.md"), "invalid");
    expect(() => reviewOpenClaw(source, join(root, "invalid"), true)).toThrow();
    expect(existsSync(join(root, "invalid"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
