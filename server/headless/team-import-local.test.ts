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

it("previews selected notes, records provenance, and stages identical input idempotently", () => {
  const root = mkdtempSync(join(tmpdir(), "omb-openclaw-notes-"));
  try {
    const source = join(root, "source"), out = join(root, "draft");
    mkdirSync(source);
    const note = "Preserve source codes exactly.\n";
    writeFileSync(join(source, "AGENTS.md"), note);
    writeFileSync(join(source, "MEMORY.md"), note);
    const opts = { notes: "MEMORY.md,AGENTS.md,MEMORY.md" };
    const plan = reviewOpenClaw(source, out, false, { ...opts, dryRun: true });
    expect(existsSync(out)).toBe(false);
    expect(plan.items).toMatchObject([{ source: "AGENTS.md" }, { source: "MEMORY.md", duplicateOf: "AGENTS.md" }]);
    const staged = reviewOpenClaw(source, out, false, opts);
    expect(reviewOpenClaw(source, out, false, opts)).toEqual(staged);
    expect(loadTeamFile(staged.manifest).bots[0]?.skills).toMatchObject([{ name: "openclaw-agents", enabled: false }]);
    expect(readFileSync(join(out, "openclaw-agents.md"), "utf8")).toContain(note);
    expect(JSON.parse(readFileSync(join(out, "openclaw-sources.json"), "utf8")).items).toEqual(plan.items);
    writeFileSync(join(source, "MEMORY.md"), "Different content.");
    expect(() => reviewOpenClaw(source, out, false, opts)).toThrow();
    expect(() => reviewOpenClaw(source, out, false, { notes: "../AGENTS.md" })).toThrow();
    expect(readFileSync(join(out, "openclaw-agents.md"), "utf8")).toContain(note);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
