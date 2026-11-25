import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WORKFLOW_FILE, type Workflow } from "../../shared/skill-burger/format.ts";
import { librarySkillDirectory, readSkillLibraryIndex, setLibrarySkillEveryBot, setLibrarySkillOptOut } from "../skill-library.ts";
import { installSkill, listSkills, setSkillEnabled, skillsSystemPrompt } from "../skills.ts";
import { findWorkflowSkill, listWorkflowSkills, readWorkflowSkill, removeWorkflowSkill, renameWorkflowSkill, saveWorkflowSkill, setWorkflowEveryChat, workflowSkillsPrompt } from "./store.ts";

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
