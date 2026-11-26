import { expect, it } from "vitest";

import type { SkillsLibraryHost } from "./host/skills-library.ts";
import { skillExport } from "./skill-export.ts";
import type { BotRecord } from "./store.ts";

it("does not include a workflow's private origin bot in exported packages", () => {
  const bot = { id: "visible-bot" } as BotRecord;
  const host = {
    listBotSkills: () => [{ name: "shared-workflow", description: "Fixture", source: "skill-burger:private-origin" }],
    readBotSkillFile: () => "fixture",
  } as unknown as Pick<SkillsLibraryHost, "listBotSkills" | "readBotSkillFile">;
  const exporting = skillExport(host);
  expect(JSON.stringify([...exporting.collectExportSkills([bot], ["shared-workflow"]).values()])).not.toContain("private-origin");
  const team = exporting.collectTeamSkills([bot], "all");
  expect(team.ok).toBe(true);
  if (!team.ok) throw new Error(team.error);
  expect(JSON.stringify([...team.skillsByBot.values()])).not.toContain("private-origin");
});
