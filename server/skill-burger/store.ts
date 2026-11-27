import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";

import { burgerBotOf, burgerSource, isBurgerSource, type SavedWorkflow } from "../../shared/skill-burger/saved.ts";
import { isSkillName } from "../../shared/skill-md.ts";
import { caseOf, WORKFLOW_FILE, WORKFLOW_MAX_BYTES, WORKFLOW_TAG, renderWorkflowSkillMd, workflowSchema, workflowSkillName, type Workflow } from "../../shared/skill-burger/format.ts";
import {
  installLibrarySkill, libraryContentMatches, librarySkillDirectory, librarySkillFilePath, librarySkillOptOuts, listLibrarySkills, readLibrarySkillFile, readSkillLibraryIndex,
  retireLibrarySkill, setLibrarySkillEveryBot, skillsLibraryRoot,
} from "../skill-library.ts";
import { installSkill, listMigratableSkills, listSkills, readSkillFile, removeSkill, setSkillEnabled } from "../skills.ts";
import { writeFileAtomic } from "../atomic.ts";

export type { SavedWorkflow };

const PROMPT_MAX_SKILLS = 20;
const PROMPT_MAX_BYTES = 2_000;

export type BurgerPlace = { botId: string } | { everyChat: true };
type Failure = { error: string; taken?: true };

function parsed(path: string | null): Workflow | null {
  if (!path) return null;
  let descriptor: number | undefined;
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.size > WORKFLOW_MAX_BYTES) return null;
    descriptor = openSync(path, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size > WORKFLOW_MAX_BYTES || opened.ino !== before.ino || opened.dev !== before.dev) return null;
    const checked = workflowSchema.safeParse(JSON.parse(readFileSync(descriptor, "utf8")));
    return checked.success ? checked.data : null;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

const workflowHash = (skillHash: string, workflow: Workflow, audience = "private") => createHash("sha256").update(skillHash).update("\0").update(audience).update("\0").update(JSON.stringify(workflow)).digest("hex");

function readAt(place: BurgerPlace, name: string, root: string, purpose: "use" | "inspect" = "use"): { workflow: Workflow; sha256: string; fileSha256: string; botId?: string } | null {
  if (!isSkillName(name)) return null;
  if ("everyChat" in place) {
    const entry = readSkillLibraryIndex(root)[name];
    if (entry?.name !== name || !entry.tags?.includes(WORKFLOW_TAG)) return null;
    if (purpose === "use" && entry.reviewState !== "approved") return null;
    if (purpose === "inspect" && (!entry.filesSha256 || !entry.files?.includes(WORKFLOW_FILE))) return null;
    if (!libraryContentMatches(root, entry)) return null;
    const workflow = parsed(join(librarySkillDirectory(root, name), WORKFLOW_FILE));
    return workflow ? { workflow, sha256: workflowHash(entry.sha256, workflow, entry.everyBot ? "all" : "assigned"), fileSha256: entry.sha256, botId: entry.workflowOriginBot ?? burgerBotOf(entry.source) } : null;
  }
  const entry = listMigratableSkills(place.botId).find((skill) => skill.name === name && skill.intact && isBurgerSource(skill.source));
  const workflow = parsed(entry?.directory ? join(entry.directory, WORKFLOW_FILE) : null);
  return workflow && entry ? { workflow, sha256: workflowHash(entry.sha256, workflow), fileSha256: entry.sha256, botId: place.botId } : null;
}

const listed = (name: string, workflow: Workflow, sha256: string, savedAt: string, everyChat: boolean, botId: string | undefined): SavedWorkflow => ({
  name, summary: workflow.summary, sha256, savedAt, everyChat, ...(botId ? { botId } : {}),
  layers: workflow.steps.map((step) => { const on = caseOf(step); return { id: step.id, kind: step.kind, label: step.label, ...(step.kind === "app" ? { app: step.app } : {}), ...(step.kind === "decide" ? { cases: step.cases } : {}), ...(on ? { on } : {}) }; }),
  args: Object.keys(workflow.args),
});

export function listWorkflowSkills(botIds: readonly string[], root: string = skillsLibraryRoot()): SavedWorkflow[] {
  const index = readSkillLibraryIndex(root);
  const shared = listLibrarySkills(root)
    .filter((skill) => skill.enabled && skill.tags?.includes(WORKFLOW_TAG))
    .flatMap((skill) => {
      const found = readAt({ everyChat: true }, skill.name, root);
      return found ? [listed(skill.name, found.workflow, found.sha256, index[skill.name]!.importedAt, true, found.botId)] : [];
    });
  const own = botIds.flatMap((botId) => listSkills(botId)
    .filter((skill) => skill.enabled && isBurgerSource(skill.source))
    .flatMap((skill) => {
      const found = readAt({ botId }, skill.name, root);
      return found ? [listed(skill.name, found.workflow, found.sha256, skill.importedAt, false, botId)] : [];
    }));
  return [...shared, ...own].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function inspectWorkflowDependencies(place: BurgerPlace, name: string, root: string = skillsLibraryRoot()): Workflow | null {
  return readAt(place, name, root, "inspect")?.workflow ?? null;
}

export function readWorkflowSkill(place: BurgerPlace, name: string, root: string = skillsLibraryRoot()): { text: string; workflow: Workflow; sha256: string } | null {
  const found = readAt(place, name, root);
  if (!found) return null;
  try {
    const text = "everyChat" in place ? readLibrarySkillFile(name, root) : readSkillFile(place.botId, name);
    return text === null ? null : { text, workflow: found.workflow, sha256: found.sha256 };
  } catch {
    return null;
  }
}

function taken(botIds: readonly string[], root: string): Set<string> {
  return new Set([...Object.keys(readSkillLibraryIndex(root)), ...botIds.flatMap((botId) => listSkills(botId).map((skill) => skill.name))]);
}

function write(place: BurgerPlace, name: string, workflow: Workflow, origin: string | undefined, root: string, everyBot = true): SavedWorkflow | Failure {
  const body = `${JSON.stringify(workflow, null, 2)}\n`;
  if (Buffer.byteLength(body, "utf8") > WORKFLOW_MAX_BYTES) return { error: "This run is too large to save as a skill." };
  const files = [{ path: "SKILL.md", content: renderWorkflowSkillMd(name, workflow) }, { path: WORKFLOW_FILE, content: body }];
  const botId = "botId" in place ? place.botId : origin;
  const source = "everyChat" in place ? "skill-burger" : botId ? burgerSource(botId) : "skill-burger";
  if ("everyChat" in place) {
    const installed = installLibrarySkill({ name, instructions: files[0]!.content, source, ...(botId ? { workflowOriginBot: botId } : {}), tags: [WORKFLOW_TAG], reviewState: "approved", files: [files[1]!], root });
    if ("error" in installed) return { error: installed.error };
    const audience = setLibrarySkillEveryBot(name, everyBot, root);
    if ("error" in audience) return { error: audience.error };
  } else {
    const installed = installSkill(place.botId, source, files);
    if ("error" in installed) return { error: installed.error };
    const enabled = setSkillEnabled(place.botId, name, true);
    if ("error" in enabled) return { error: enabled.error };
  }
  const stored = listWorkflowSkills("botId" in place ? [place.botId] : [], root).find((skill) => skill.name === name && skill.everyChat === ("everyChat" in place));
  return stored ?? { error: "The skill was saved but can't be read back." };
}

function erase(place: BurgerPlace, name: string, sha256: string, root: string): { removed: true } | { stale: true } | { error: string } {
  const found = readAt(place, name, root);
  if (!found || found.sha256 !== sha256) return { stale: true };
  if ("everyChat" in place) {
    const result = retireLibrarySkill(name, found.fileSha256, root);
    return "retired" in result ? { removed: true } : result;
  }
  const result = removeSkill(place.botId, name);
  return "removed" in result ? { removed: true } : result;
}

export function saveWorkflowSkill(input: { workflow: unknown; place: BurgerPlace; botIds: readonly string[]; name?: string; origin?: string; root?: string }): SavedWorkflow | Failure {
  const root = input.root ?? skillsLibraryRoot();
  const checked = workflowSchema.safeParse(input.workflow);
  if (!checked.success) return { error: "This run can't be saved as a skill." };
  const asked = input.name?.trim();
  const origin = "botId" in input.place ? input.place.botId : input.origin;
  const same = JSON.stringify(checked.data);
  if (!asked) {
    const already = listWorkflowSkills(input.botIds, root).find((skill) => skill.botId === origin && JSON.stringify(readAt(skill.everyChat ? { everyChat: true } : { botId: skill.botId! }, skill.name, root)?.workflow) === same);
    if (already) return already;
  }
  const names = taken(input.botIds, root);
  if (asked) {
    if (!isSkillName(asked)) return { error: "Use lowercase letters, numbers and hyphens for the name." };
    if (names.has(asked)) return { error: "That name is taken. Try another.", taken: true };
  }
  return write(input.place, asked || workflowSkillName(checked.data.summary, names), checked.data, input.origin, root);
}

export function removeWorkflowSkill(place: BurgerPlace, name: string, sha256: string | undefined, root: string = skillsLibraryRoot()) {
  const found = readAt(place, name, root);
  if (!found) return { stale: true } as const;
  return erase(place, name, sha256 ?? found.sha256, root);
}

export function setWorkflowEveryChat(input: { name: string; everyChat: boolean; botIds: readonly string[]; botId?: string; sha256?: string; root?: string }): SavedWorkflow | Failure | { stale: true } {
  const root = input.root ?? skillsLibraryRoot();
  const from: BurgerPlace = input.everyChat ? { botId: input.botId ?? "" } : { everyChat: true };
  const found = readAt(from, input.name, root);
  if (!found || (input.sha256 && found.sha256 !== input.sha256)) return { stale: true };
  const to: BurgerPlace = input.everyChat ? { everyChat: true } : { botId: found.botId ?? "" };
  if ("botId" in to && !input.botIds.includes(to.botId)) return { error: "The bot this Skill Burger came from is gone." };
  if ("everyChat" in to ? readSkillLibraryIndex(root)[input.name] : listSkills(to.botId).some((skill) => skill.name === input.name)) return { error: "That name is taken. Try another.", taken: true };
  const moved = write(to, input.name, found.workflow, found.botId, root);
  if ("error" in moved) return moved;
  const gone = erase(from, input.name, found.sha256, root);
  if (!("removed" in gone)) {
    erase(to, input.name, moved.sha256, root);
    return "error" in gone ? gone : { stale: true };
  }
  return moved;
}

/** The burger a bot runs by this name: its own first, then one used in every chat. */
export function findWorkflowSkill(botId: string, name: string, root: string = skillsLibraryRoot(), assigned: readonly string[] = [], allowShared = true): { place: BurgerPlace; workflow: Workflow; sha256: string } | null {
  const ownSkill = listSkills(botId).find((skill) => skill.name === name);
  if (ownSkill) {
    const own = ownSkill.enabled ? readAt({ botId }, name, root) : null;
    return own ? { place: { botId }, workflow: own.workflow, sha256: own.sha256 } : null;
  }
  if (!allowShared) return null;
  const shared = readSkillLibraryIndex(root)[name];
  if (!shared || (!assigned.includes(name) && (!shared.everyBot || librarySkillOptOuts(botId).has(name)))) return null;
  const found = readAt({ everyChat: true }, name, root);
  return found ? { place: { everyChat: true }, workflow: found.workflow, sha256: found.sha256 } : null;
}

/** Puts a changed workflow in place of the copy with `sha256`, under the same name; the old copy comes back if the new
 * one can't be written. */
export function replaceWorkflowSkill(input: { place: BurgerPlace; name: string; workflow: unknown; sha256: string; root?: string }): SavedWorkflow | Failure | { stale: true } {
  const root = input.root ?? skillsLibraryRoot();
  const checked = workflowSchema.safeParse(input.workflow);
  if (!checked.success) return { error: checked.error.issues.map((issue) => issue.message).join("; ").slice(0, 300) };
  const found = readAt(input.place, input.name, root);
  if (!found || found.sha256 !== input.sha256) return { stale: true };
  const everyBot = "everyChat" in input.place ? readSkillLibraryIndex(root)[input.name]?.everyBot === true : true;
  let backup: string;
  const recoveryId = randomUUID();
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (!lstatSync(root).isDirectory()) throw new Error("the library is not a real directory");
    const directory = join(realpathSync(root), "workflow-recovery");
    if (!lstatSync(directory, { throwIfNoEntry: false })) mkdirSync(directory, { mode: 0o700 });
    if (!lstatSync(directory).isDirectory()) throw new Error("the recovery location is not a real directory");
    backup = join(directory, `${recoveryId}.json`);
    writeFileAtomic(backup, JSON.stringify({ name: input.name, place: input.place, workflow: found.workflow, sha256: found.sha256, botId: found.botId, everyBot }), { mode: 0o600 });
  } catch {
    return { error: "The workflow could not be backed up, so it was not changed." };
  }
  const discard = () => { try { rmSync(backup, { force: true }); } catch {} };
  const originalIntact = () => {
    const current = readAt(input.place, input.name, root);
    return current?.sha256 === found.sha256 && JSON.stringify(current.workflow) === JSON.stringify(found.workflow) && (!("everyChat" in input.place) || (readSkillLibraryIndex(root)[input.name]?.everyBot === true) === everyBot);
  };
  const restore = () => {
    if (originalIntact()) return true;
    try {
      if (readAt(input.place, input.name, root)) return false;
      write(input.place, input.name, found.workflow, found.botId, root, everyBot);
      return originalIntact();
    } catch { return false; }
  };
  try {
    const gone = erase(input.place, input.name, found.sha256, root);
    if (!("removed" in gone)) {
      if (originalIntact()) discard();
      return "error" in gone ? gone : { stale: true };
    }
    const written = write(input.place, input.name, checked.data, found.botId, root, everyBot);
    if (!("error" in written)) { discard(); return written; }
    if (restore()) { discard(); return written; }
    return { error: `The update failed; the original is in recovery (${recoveryId}).` };
  } catch {
    if (restore()) { discard(); return { error: "The update failed; the original workflow was restored." }; }
    return { error: `The update failed; the original is in recovery (${recoveryId}).` };
  }
}

/** Rename: the same burger under a new name in the same place, with its SKILL.md written for that name. */
export function renameWorkflowSkill(input: { place: BurgerPlace; name: string; to: string; botIds: readonly string[]; sha256?: string; root?: string }): SavedWorkflow | Failure | { stale: true } {
  const root = input.root ?? skillsLibraryRoot();
  const found = readAt(input.place, input.name, root);
  if (!found || (input.sha256 && found.sha256 !== input.sha256)) return { stale: true };
  if (!isSkillName(input.to)) return { error: "Use lowercase letters, numbers and hyphens for the name." };
  if (taken(input.botIds, root).has(input.to)) return { error: "That name is taken. Try another.", taken: true };
  const renamed = write(input.place, input.to, found.workflow, found.botId, root);
  if ("error" in renamed) return renamed;
  const gone = erase(input.place, input.name, found.sha256, root);
  if (!("removed" in gone)) {
    erase(input.place, input.to, renamed.sha256, root);
    return "error" in gone ? gone : { stale: true };
  }
  return renamed;
}

export function workflowSkillsPrompt(botId: string, root: string = skillsLibraryRoot()): string {
  const optedOut = librarySkillOptOuts(botId);
  const lines: string[] = [];
  let bytes = 0;
  for (const saved of listWorkflowSkills([], root)) {
    if (optedOut.has(saved.name) || lines.length >= PROMPT_MAX_SKILLS) continue;
    const line = `- ${saved.name}: ${saved.summary} Read ${JSON.stringify(librarySkillFilePath(saved.name, root))}.`;
    if (bytes + line.length > PROMPT_MAX_BYTES) break;
    bytes += line.length + 1;
    lines.push(line);
  }
  return lines.length
    ? `\n\nSaved workflows (runs the person saved as skills for every chat; use one only when the person requests it, and follow the current conversation's approvals):\n${lines.join("\n")}`
    : "";
}
