import { skillMentions } from "../shared/skill-command.ts";
import type { NewBotDefaults } from "./new-bot-defaults.ts";
import { isBurgerSource } from "../shared/skill-burger/saved.ts";
import { WORKFLOW_TAG } from "../shared/skill-burger/format.ts";
import { readSkillLibraryIndex } from "./skill-library.ts";
import { inspectWorkflowDependencies } from "./skill-burger/store.ts";
import type { Routine } from "./routines.ts";
import { listSkills, readSkillFile, maintainLearnedSkill } from "./skills.ts";

type RoutineRef = Pick<Routine, "botId" | "name" | "prompt"> & Pick<Partial<Routine>, "groupId">;

function workflowMentions(value: unknown, matches: (text: string) => boolean): boolean {
  if (typeof value === "string") return matches(value);
  return Boolean(value && typeof value === "object" && Object.values(value).some(child => workflowMentions(child, matches)));
}

export function skillDependencies(name: string, botId: string, routines: RoutineRef[], templates: NewBotDefaults | undefined,
  ownerAssignments: readonly string[] | undefined, groups: readonly { id: string; memberIds: string[] }[] = [],
  presets: readonly { skills?: string[] }[] = []): Set<string> {
  const kinds = new Set<string>();
  const mentions = (text: string) => skillMentions(text).includes(name);
  if (routines.some(routine => (routine.botId === botId || groups.some(group => group.id === routine.groupId && group.memberIds.includes(botId))) && mentions(routine.prompt))) kinds.add("routine");
  if (presets.some(preset => preset.skills?.includes(name)) || templates?.skills.some(skill => skill.name === name || mentions(skill.text)) || templates?.routines.some(routine => mentions(routine.prompt))) kinds.add("template");
  if (ownerAssignments?.includes(name)) kinds.add("team");
  const workflows = [
    ...listSkills(botId).filter(skill => isBurgerSource(skill.source)).map(skill => ({ name: skill.name, place: { botId } })),
    ...Object.values(readSkillLibraryIndex()).filter(skill => skill.tags?.includes(WORKFLOW_TAG)).map(skill => ({ name: skill.name, place: { everyChat: true as const } })),
  ];
  for (const saved of workflows) {
    const definition = inspectWorkflowDependencies(saved.place, saved.name);
    if (!definition || workflowMentions(definition, mentions)) { kinds.add("workflow"); break; }
  }
  return kinds;
}

const terms = (text: string): Set<string> => new Set((text.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
export function similarLearnedSkills(botId: string, name: string): string[] {
  const own = terms(readSkillFile(botId, name) ?? "");
  if (own.size < 5) return [];
  return listSkills(botId).filter(skill => skill.name !== name && skill.reviewedRevision).flatMap(skill => {
    const other = terms(readSkillFile(botId, skill.name) ?? "");
    const both = [...own].filter(term => other.has(term)).length;
    return both >= 5 && both / (own.size + other.size - both) >= 0.85 ? [skill.name] : [];
  });
}

export function consolidateLearnedSkill(botId: string, redundant: string, revision: string, keep: string, keepRevision: string, referenced: boolean) {
  const target = listSkills(botId).find(skill => skill.name === keep && skill.enabled && skill.reviewedRevision === keepRevision);
  if (!target || revision.split(":")[1] !== keepRevision.split(":")[1] || !similarLearnedSkills(botId, redundant).includes(keep)) {
    return { error: "Compare the current revisions again. The retained skill must be enabled and have matching reference files." };
  }
  return maintainLearnedSkill(botId, redundant, revision, "archive", referenced);
}
