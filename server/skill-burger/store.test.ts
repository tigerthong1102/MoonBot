import { mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WORKFLOW_FILE, type Workflow } from "../../shared/skill-burger/format.ts";
import { librarySkillDirectory, readSkillLibraryIndex, setLibrarySkillReviewState, setLibrarySkillEveryBot, setLibrarySkillOptOut } from "../skill-library.ts";
import { installSkill, listMigratableSkills, listSkills, setSkillEnabled, skillsSystemPrompt } from "../skills.ts";
import { findWorkflowSkill, inspectWorkflowDependencies, listWorkflowSkills, readWorkflowSkill, removeWorkflowSkill, renameWorkflowSkill, replaceWorkflowSkill, saveWorkflowSkill, setWorkflowEveryChat, workflowSkillsPrompt } from "./store.ts";

const workflow: Workflow = {
  version: 1,
  summary: "Email the weekly sales sheet to Priya",
  args: { recipient: { default: "priya@example.com", label: "recipient email" } },
  steps: [
    { id: "s1", kind: "app", app: "googlesheets", tool: "GOOGLESHEETS_BATCH_GET", label: "Read from Google Sheets", args: { spreadsheet_id: "1AbC" } },
    { id: "s2", kind: "ai", deterministic: false, label: "Write the body", prompt: "Write it.", input: { $step: "s1" } },
    { id: "s3", kind: "app", app: "gmail", tool: "GMAIL_SEND_EMAIL", label: "Send email", args: { recipient_email: { $arg: "recipient" }, body: { $step: "s2" } } },
  ],
};

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "burger-"));
  const bot = `burger-bot-${Math.random().toString(36).slice(2, 10)}`;
  return { root, bot, botIds: [bot] };
};

describe("saved burgers", () => {
  it("saves a run to the bot that made it, as that bot's own skill with its steps beside it", () => {
    const { root, bot, botIds } = fixture();
    const saved = saveWorkflowSkill({ workflow, place: { botId: bot }, botIds, root });
    if ("error" in saved) throw new Error(saved.error);
    expect(saved).toMatchObject({ name: "email-the-weekly-sales-sheet-to", everyChat: false, botId: bot, args: ["recipient"] });
    expect(saved.layers.map((layer) => [layer.kind, layer.app])).toEqual([["app", "googlesheets"], ["ai", undefined], ["app", "gmail"]]);
    expect(listSkills(bot)).toEqual([expect.objectContaining({ name: saved.name, enabled: true, source: `skill-burger:${bot}` })]);
    expect(readSkillLibraryIndex(root)).toEqual({});
    expect(readWorkflowSkill({ botId: bot }, saved.name, root)).toMatchObject({ workflow });
    expect(skillsSystemPrompt(bot)).toContain(`- ${saved.name}: ${workflow.summary}`);
    expect(workflowSkillsPrompt(bot, root)).toBe("");
    expect(listWorkflowSkills(botIds, root).map((skill) => [skill.name, skill.everyChat])).toEqual([[saved.name, false]]);
  });

  it("turns Use in every chat on and off: into the library for every bot, then back to the bot it came from", () => {
    const { root, bot, botIds } = fixture();
    const saved = saveWorkflowSkill({ workflow, place: { botId: bot }, botIds, root });
    if ("error" in saved) throw new Error(saved.error);
    const shared = setWorkflowEveryChat({ name: saved.name, everyChat: true, botId: bot, botIds, sha256: saved.sha256, root });
    expect(shared).toMatchObject({ name: saved.name, everyChat: true, botId: bot });
    expect(readSkillLibraryIndex(root)[saved.name]).toMatchObject({ everyBot: true, reviewState: "approved", tags: ["workflow"], source: "skill-burger", workflowOriginBot: bot, files: [WORKFLOW_FILE] });
    expect(JSON.parse(readFileSync(join(librarySkillDirectory(root, saved.name), WORKFLOW_FILE), "utf8"))).toEqual(workflow);
    expect(listSkills(bot)).toEqual([]);
    expect(workflowSkillsPrompt("any-other-bot", root)).toContain(`- ${saved.name}: ${workflow.summary} Read`);

    const back = setWorkflowEveryChat({ name: saved.name, everyChat: false, botIds, root });
    expect(back).toMatchObject({ name: saved.name, everyChat: false, botId: bot });
    expect(readSkillLibraryIndex(root)).toEqual({});
    expect(listSkills(bot).map((skill) => skill.name)).toEqual([saved.name]);
  });

  it("keeps the shared workflow available after its origin bot is deleted", () => {
    const { root, bot } = fixture();
    const saved = saveWorkflowSkill({ workflow, name: "shared-sales", place: { everyChat: true }, origin: bot, botIds: [bot], root });
    if ("error" in saved) throw new Error(saved.error);
    const moved = setWorkflowEveryChat({ name: saved.name, everyChat: false, botIds: [], sha256: saved.sha256, root });
    expect(moved).toEqual({ error: "The bot this Skill Burger came from is gone." });
    expect(listWorkflowSkills([], root)).toContainEqual(saved);
    expect(listSkills(bot)).toEqual([]);
  });

  it("normalizes legacy shared sources while retaining the origin for moving back", () => {
    const { root, bot, botIds } = fixture();
    const saved = saveWorkflowSkill({ workflow, name: "legacy-shared", place: { everyChat: true }, origin: bot, botIds, root });
    if ("error" in saved) throw new Error(saved.error);
    const path = join(root, "index.json");
    const index = JSON.parse(readFileSync(path, "utf8"));
    index[saved.name].source = `skill-burger:${bot}`;
    delete index[saved.name].workflowOriginBot;
    writeFileSync(path, JSON.stringify(index));
    expect(readSkillLibraryIndex(root)[saved.name]).toMatchObject({ source: "skill-burger", workflowOriginBot: bot });
    expect(setWorkflowEveryChat({ name: saved.name, everyChat: false, botIds, root })).toMatchObject({ botId: bot, everyChat: false });
  });

  it("only lets a bot use a shared workflow assigned to it or enabled for every bot", () => {
    const { root, bot } = fixture();
    const saved = saveWorkflowSkill({ workflow, name: "scoped-workflow", place: { everyChat: true }, botIds: [bot], root });
    if ("error" in saved) throw new Error(saved.error);
    expect(findWorkflowSkill(bot, saved.name, root)).not.toBeNull();
    expect(findWorkflowSkill(bot, saved.name, root, [saved.name], false)).toBeNull();
    setLibrarySkillOptOut(bot, saved.name, true);
    expect(findWorkflowSkill(bot, saved.name, root)).toBeNull();
    expect(findWorkflowSkill(bot, saved.name, root, [saved.name])).not.toBeNull();
    setLibrarySkillOptOut(bot, saved.name, false);
    setLibrarySkillEveryBot(saved.name, false, root);
    expect(findWorkflowSkill(bot, saved.name, root)).toBeNull();
    expect(findWorkflowSkill(bot, saved.name, root, [saved.name])).not.toBeNull();
  });

  it("does not fall through to a shared workflow when a private skill has the same name", () => {
    const { root, bot } = fixture();
    const saved = saveWorkflowSkill({ workflow, name: "private-collision", place: { everyChat: true }, botIds: [bot], root });
    if ("error" in saved) throw new Error(saved.error);
    const installed = installSkill(bot, "fixture", [{ path: "SKILL.md", content: "---\nname: private-collision\ndescription: Private skill\n---\nPrivate instructions.\n" }]);
    expect(installed).not.toHaveProperty("error");
    expect(findWorkflowSkill(bot, saved.name, root)).toBeNull();
  });

  it("refuses a private workflow after its owner disables it", () => {
    const { root, bot, botIds } = fixture();
    const saved = saveWorkflowSkill({ workflow, name: "private-disabled", place: { botId: bot }, botIds, root });
    if ("error" in saved) throw new Error(saved.error);
    expect(findWorkflowSkill(bot, saved.name, root)).not.toBeNull();
    setSkillEnabled(bot, saved.name, false);
    expect(findWorkflowSkill(bot, saved.name, root)).toBeNull();
  });

  it.skipIf(process.platform === "win32")("leaves a workflow untouched if its recovery location is a symlink", () => {
    const { root, bot, botIds } = fixture();
    const saved = saveWorkflowSkill({ workflow, name: "recovery-fixture", place: { botId: bot }, botIds, root });
    if ("error" in saved) throw new Error(saved.error);
    symlinkSync(mkdtempSync(join(tmpdir(), "burger-outside-")), join(root, "workflow-recovery"));
    const changed = { ...workflow, summary: "Changed" };
    expect(replaceWorkflowSkill({ place: { botId: bot }, name: saved.name, workflow: changed, sha256: saved.sha256, root })).toHaveProperty("error");
    expect(readWorkflowSkill({ botId: bot }, saved.name, root)?.workflow).toEqual(workflow);
  });

  it("restores the original if a replacement cannot be saved", () => {
    const { root, bot, botIds } = fixture();
    const saved = saveWorkflowSkill({ workflow, name: "restore-fixture", place: { botId: bot }, botIds, root });
    if ("error" in saved) throw new Error(saved.error);
    const oversized = { ...workflow, args: { ...workflow.args, large: { default: "x".repeat(300_000) } } };
    expect(replaceWorkflowSkill({ place: { botId: bot }, name: saved.name, workflow: oversized, sha256: saved.sha256, root })).toHaveProperty("error");
    expect(readWorkflowSkill({ botId: bot }, saved.name, root)?.workflow).toEqual(workflow);
    expect(readdirSync(join(root, "workflow-recovery"))).toEqual([]);
  });

  it("preserves an assigned-only audience after replacement and rollback", () => {
    const { root, bot, botIds } = fixture();
    const saved = saveWorkflowSkill({ workflow, name: "assigned-only", place: { everyChat: true }, botIds, root });
    if ("error" in saved) throw new Error(saved.error);
    setLibrarySkillEveryBot(saved.name, false, root);
    const latest = listWorkflowSkills(botIds, root).find((skill) => skill.name === saved.name)!;
    const changed = replaceWorkflowSkill({ place: { everyChat: true }, name: saved.name, workflow: { ...workflow, summary: "Changed" }, sha256: latest.sha256, root });
    if ("error" in changed || "stale" in changed) throw new Error("replace failed");
    expect(readSkillLibraryIndex(root)[saved.name]?.everyBot).not.toBe(true);
    expect(findWorkflowSkill(bot, saved.name, root)).toBeNull();
    const oversized = { ...workflow, args: { large: { default: "x".repeat(300_000) } } };
    expect(replaceWorkflowSkill({ place: { everyChat: true }, name: saved.name, workflow: oversized, sha256: changed.sha256, root })).toHaveProperty("error");
    expect(readSkillLibraryIndex(root)[saved.name]?.everyBot).not.toBe(true);
    expect(findWorkflowSkill(bot, saved.name, root)).toBeNull();
  });

  it("rejects edits and removals after workflow content changes without changing its rendered skill", () => {
    const { root, botIds } = fixture();
    const original = { version: 1 as const, summary: "Fixture", args: {}, steps: [{ id: "s1", kind: "shell" as const, label: "Run", run: `printf first\n${"x".repeat(150)} old` }] };
    const saved = saveWorkflowSkill({ workflow: original, name: "stale-workflow", place: { everyChat: true }, botIds, root });
    if ("error" in saved) throw new Error(saved.error);
    const changed = { ...original, steps: [{ ...original.steps[0]!, run: `printf first\n${"x".repeat(150)} new` }] };
    writeFileSync(join(librarySkillDirectory(root, saved.name), WORKFLOW_FILE), JSON.stringify(changed));
    expect(replaceWorkflowSkill({ place: { everyChat: true }, name: saved.name, workflow: original, sha256: saved.sha256, root })).toEqual({ stale: true });
    expect(removeWorkflowSkill({ everyChat: true }, saved.name, saved.sha256, root)).toEqual({ stale: true });
    expect(JSON.parse(readFileSync(join(librarySkillDirectory(root, saved.name), WORKFLOW_FILE), "utf8"))).toEqual(changed);
  });

  it("detects a changed private workflow even when the rendered skill hash is unchanged", () => {
    const { root, bot, botIds } = fixture();
    const original = { version: 1 as const, summary: "Fixture", args: {}, steps: [{ id: "s1", kind: "shell" as const, label: "Run", run: "printf first\nprintf old" }] };
    const saved = saveWorkflowSkill({ workflow: original, name: "stale-private", place: { botId: bot }, botIds, root });
    if ("error" in saved) throw new Error(saved.error);
    const path = join(listMigratableSkills(bot).find((skill) => skill.name === saved.name)!.directory!, WORKFLOW_FILE);
    const changed = { ...original, steps: [{ ...original.steps[0]!, run: "printf first\nprintf new" }] };
    writeFileSync(path, JSON.stringify(changed));
    expect(replaceWorkflowSkill({ place: { botId: bot }, name: saved.name, workflow: original, sha256: saved.sha256, root })).toEqual({ stale: true });
    expect(removeWorkflowSkill({ botId: bot }, saved.name, saved.sha256, root)).toEqual({ stale: true });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(changed);
  });

  it("refuses a taken or malformed name and a workflow that isn't one", () => {
    const { root, bot, botIds } = fixture();
    saveWorkflowSkill({ workflow, name: "sales-email", place: { botId: bot }, botIds, root });
    expect(saveWorkflowSkill({ workflow, name: "sales-email", place: { everyChat: true }, botIds, root })).toMatchObject({ taken: true });
    expect(saveWorkflowSkill({ workflow, name: "Sales Email", place: { botId: bot }, botIds, root })).toHaveProperty("error");
    expect(saveWorkflowSkill({ workflow: { ...workflow, steps: [] }, place: { botId: bot }, botIds, root })).toHaveProperty("error");
    expect(saveWorkflowSkill({ workflow, place: { botId: bot }, botIds, root })).toMatchObject({ name: "sales-email" });
  });

  it("renames in place, and undoes a save, but never a copy that changed since", () => {
    const { root, bot, botIds } = fixture();
    const saved = saveWorkflowSkill({ workflow, place: { botId: bot }, botIds, root });
    if ("error" in saved) throw new Error(saved.error);
    const renamed = renameWorkflowSkill({ place: { botId: bot }, name: saved.name, to: "weekly-sales", botIds, root });
    if ("error" in renamed || "stale" in renamed) throw new Error("rename failed");
    expect(readWorkflowSkill({ botId: bot }, "weekly-sales", root)?.text).toContain("name: weekly-sales");
    expect(removeWorkflowSkill({ botId: bot }, "weekly-sales", "0".repeat(64), root)).toEqual({ stale: true });
    expect(removeWorkflowSkill({ botId: bot }, "weekly-sales", renamed.sha256, root)).toEqual({ removed: true });
    expect(listWorkflowSkills(botIds, root)).toEqual([]);

    const again = saveWorkflowSkill({ workflow, place: { everyChat: true }, origin: bot, botIds, root });
    if ("error" in again) throw new Error(again.error);
    writeFileSync(join(librarySkillDirectory(root, again.name), WORKFLOW_FILE), "{}");
    expect(listWorkflowSkills(botIds, root)).toEqual([]);
    expect(removeWorkflowSkill({ everyChat: true }, again.name, again.sha256, root)).toEqual({ stale: true });
  });
});

it("saving the same run again from the same bot gives back the burger it already saved", () => {
  const root = mkdtempSync(join(tmpdir(), "burger-"));
  const bot = `burger-bot-${Math.random().toString(36).slice(2, 10)}`;
  const first = saveWorkflowSkill({ workflow, place: { botId: bot }, botIds: [bot], root });
  const again = saveWorkflowSkill({ workflow, place: { botId: bot }, botIds: [bot], root });
  expect(again).toEqual(first);
  expect(listWorkflowSkills([bot], root)).toHaveLength(1);
});

it("inspects a disabled library workflow with verified bytes and keeps it unavailable to the runner", () => {
  const { root, bot, botIds } = fixture();
  const place = { everyChat: true as const };
  const saved = saveWorkflowSkill({ root, botIds, workflow, name: "review-invoices", place });
  if ("error" in saved) throw Error(saved.error);
  expect(setLibrarySkillReviewState(saved.name, "disabled", root)).toMatchObject({ enabled: false });
  expect(inspectWorkflowDependencies(place, saved.name, root)).toEqual(workflow);
  expect(findWorkflowSkill(bot, saved.name, root)).toBeNull();
  expect(readWorkflowSkill(place, saved.name, root)).toBeNull();
  writeFileSync(join(librarySkillDirectory(root, saved.name), WORKFLOW_FILE), JSON.stringify({ ...workflow, summary: "Different revision" }));
  expect(inspectWorkflowDependencies(place, saved.name, root)).toBeNull();
});
