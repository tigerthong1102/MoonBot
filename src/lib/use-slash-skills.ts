import { useEffect, useState } from "react";
import { api } from "@/state/api";
import type { SlashSkill } from "./composer-commands";
import { skillDescription } from "./library-skill-presentation";

interface ListedSkill {
  name?: unknown;
  description?: unknown;
  enabled?: unknown;
  origin?: unknown;
  source?: unknown;
  warnings?: unknown;
}

interface SkillsResponse {
  skills?: ListedSkill[];
  library?: ListedSkill[];
}

export function composerSkills(body: SkillsResponse | null | undefined, allowLibrary: boolean): SlashSkill[] {
  const commands = new Map<string, SlashSkill>();
  for (const skill of body?.skills ?? []) {
    if (skill.enabled !== true || typeof skill.name !== "string") continue;
    commands.set(skill.name, {
      name: skill.name,
      description: skillDescription({
        name: skill.name,
        description: typeof skill.description === "string" ? skill.description : "",
        source: typeof skill.source === "string" ? skill.source : "",
      }),
    });
  }
  if (allowLibrary) {
    const localNames = new Set(body?.skills?.filter((skill) => skill.origin !== "library").map((skill) => skill.name));
    const candidates = [...(body?.library ?? []), ...(body?.skills ?? []).filter((skill) => skill.origin === "library")];
    for (const skill of candidates) {
      if (typeof skill.name !== "string" || commands.has(skill.name) || localNames.has(skill.name)) continue;
      commands.set(skill.name, {
        name: skill.name,
        description: skillDescription({
          name: skill.name,
          description: typeof skill.description === "string" ? skill.description : "",
          source: typeof skill.source === "string" ? skill.source : "",
        }),
        activate: {
          enabled: skill.enabled === true,
          warnings: Array.isArray(skill.warnings) ? skill.warnings.filter((warning) => typeof warning === "string") : [],
        },
      });
    }
  }
  return [...commands.values()];
}

export function useSlashSkills(botId: string | undefined, threadId: string, active: boolean, allowLibrary: boolean, locale: string): SlashSkill[] {
  const [skills, setSkills] = useState<{ key: string; list: SlashSkill[] } | null>(null);
  const key = JSON.stringify([botId, threadId, allowLibrary, locale]);
  useEffect(() => {
    if (!botId || !active) return;
    let cancelled = false;
    api<SkillsResponse>(`/api/bots/${encodeURIComponent(botId)}/skills?threadId=${encodeURIComponent(threadId)}`)
      .then((body) => { if (!cancelled) setSkills({ key, list: composerSkills(body, allowLibrary) }); })
      .catch(() => { if (!cancelled) setSkills({ key, list: [] }); });
    return () => {
      cancelled = true;
      setSkills(null);
    };
  }, [botId, threadId, active, allowLibrary, key]);
  return active && skills?.key === key ? skills.list : [];
}
