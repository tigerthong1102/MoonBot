import { expect, it } from "vitest";
import { ZALO_RECIPES } from "../shared/zalo-intelligence.ts";
import { loadBundledSkills, selectBundledSkills } from "./skill-library.ts";

it("keeps private review recipes out of agent turns even if an excerpt names them", () => {
  const skills = loadBundledSkills();
  for (const name of ZALO_RECIPES) {
    expect(skills.find(skill => skill.manifest.id === name)?.instructions).toContain("Đầu ra");
    for (const text of ["$" + name, "A previous participant said $" + name]) {
      expect(selectBundledSkills(text, [], skills).map(s => s.manifest.id)).not.toContain(name);
    }
  }
});
