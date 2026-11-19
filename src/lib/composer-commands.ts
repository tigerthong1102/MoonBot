import { blankCode, offersSkillCommand } from "../../shared/skill-command";
import { t } from "./i18n";

export type ComposerSlashCommandId = "goal" | "learn" | "setup" | "burst";

export type ComposerSlashCommand =
  | { kind: "command"; id: ComposerSlashCommandId; label: `/${ComposerSlashCommandId}`; description: string }
  | { kind: "skill"; id: string; label: `/${string}`; description: string; activate?: LibrarySlashActivation };

export interface LibrarySlashActivation {
  enabled: boolean;
  warnings: string[];
}

export interface SlashSkill {
  name: string;
  description: string;
  activate?: LibrarySlashActivation;
}

export function skillSlashCommands(skills: readonly SlashSkill[]): ComposerSlashCommand[] {
  return skills
    .filter((skill) => offersSkillCommand(skill.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({ kind: "skill", id: skill.name, label: `/${skill.name}`, description: skill.description, ...(skill.activate ? { activate: skill.activate } : {}) }));
}

export function composerBuiltIns(direct: boolean, dm: boolean, learn: boolean, setup: boolean): ComposerSlashCommand[] {
  const commands: ComposerSlashCommand[] = [];
  if (!dm) commands.push({ kind: "command", id: "goal", label: "/goal",
    description: t(direct ? "composer.command.goalBotDesc" : "composer.command.goalDesc") });
  if (learn) commands.push({ kind: "command", id: "learn", label: "/learn", description: t("composer.command.learnDesc") });
  if (setup) commands.push(
    { kind: "command", id: "setup", label: "/setup", description: t("composer.command.setupDesc") },
    { kind: "command", id: "burst", label: "/burst", description: t("composer.command.burstDesc") },
  );
  return commands;
}

export function rankSlashCommands(
  commands: ComposerSlashCommand[],
  query: string,
  usage: ReadonlyMap<string, number>,
): ComposerSlashCommand[] {
  const needle = query.toLowerCase();
  return commands.filter((command) => slashCommandMatches(command, query)).sort((a, b) =>
    Number(b.id === needle) - Number(a.id === needle) ||
    (b.kind === "skill" ? usage.get(b.id) ?? 0 : 0) - (a.kind === "skill" ? usage.get(a.id) ?? 0 : 0));
}

export function slashCommandMatches(command: ComposerSlashCommand, query: string): boolean {
  const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");
  const needle = normalize(query);
  return !needle || command.id.startsWith(needle) || normalize(command.description).includes(needle);
}

export interface ComposerSlashTrigger {
  query: string;
  start: number;
  end: number;
}

export function composerSlashTrigger(text: string, caretInput: number): ComposerSlashTrigger | null {
  const caret = Math.max(0, Math.min(text.length, Math.floor(caretInput)));
  const prefix = text.slice(0, caret);
  const match = /(?:^|\s)\/([\p{L}\p{N}\p{M}-]*)$/u.exec(prefix);
  if (!match) return null;
  const query = match[1] ?? "";
  const start = caret - query.length - 1;
  return blankCode(text)[start] === "/" ? { query, start, end: caret } : null;
}

export function goalTextFromComposer(text: string): string | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text);
  return match ? (match[1] ?? "").trimStart() : null;
}

/** The text a picked built-in leaves in the composer; /goal only flips the composer's mode. */
export function builtInCommandText(id: ComposerSlashCommandId): string {
  return id === "goal" ? "" : `/${id} `;
}

export function replaceComposerSlashTrigger(
  text: string,
  trigger: ComposerSlashTrigger,
  replacement: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, trigger.start)}${replacement}${text.slice(trigger.end)}`;
  return { text: next, caret: trigger.start + replacement.length };
}
