import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isSkillName } from "../shared/skill-md.ts";
import { prepareSkillFolder, type SkillFolderFile } from "./skill-folder.ts";
import { installLibrarySkill, readSkillLibraryIndex, retireLibrarySkill, setLibrarySkillEveryBot, skillsLibraryRoot } from "./skill-library.ts";

// Replace only verified copies of these bundled folders with superseded scripts.
const supersededFolders = new Map([
  ["pdf", "bae1fee03ea09067461c2f436a211a0f8ff7e6178356f81a6f61ccb04a3fd706"],
  ["dcf-model", "b2d2e4e5a884469a63ae0abef7d0e95d756b70619f94736fd9b62efe34895f98"],
  ["webapp-testing", "5a0400264fe9b7e20522ff39ab59535636b98a182448e641798554ef5d988f11"],
  ["byted-seedream-image-generate", "ad2bd0eecf45c277877237eeb0096898e0e727dddf66dc7d3fd8d2e03b4399cf"],
]);

const catalogSchema = z.array(z.object({
  name: z.string().refine(isSkillName),
  source: z.url({ protocol: /^https$/, hostname: /^github\.com$/ }),
  license: z.literal("Apache-2.0"),
}));

function readCatalogFolder(directory: string, prefix = ""): SkillFolderFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const relative = prefix + entry.name;
    if (entry.isDirectory()) return readCatalogFolder(path, relative + "/");
    if (!entry.isFile()) throw new Error(`invalid catalog file: ${relative}`);
    return [{ path: relative, content: readFileSync(path) }];
  });
}

export function installStartupBotSkillCatalog({
  catalog = join(process.env.OMB_SKILLS_DIR || join(process.cwd(), "skills"), "catalog"),
  root = skillsLibraryRoot(),
} = {}): { installed: number; failed: string[] } {
  let source: string;
  try {
    source = readFileSync(join(catalog, "index.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { installed: 0, failed: [] };
    throw error;
  }
  const entries = catalogSchema.parse(JSON.parse(source));
  if (new Set(entries.map(({ name }) => name)).size !== entries.length) {
    throw new Error("duplicate names in the StartupBot skill catalog");
  }

  const existing = readSkillLibraryIndex(root);
  let installed = 0;
  const failed: string[] = [];
  for (const entry of entries) {
    const previous = Object.hasOwn(existing, entry.name) ? existing[entry.name] : undefined;
    if (previous && (previous.source !== entry.source || !previous.filesSha256 ||
        previous.filesSha256 !== supersededFolders.get(entry.name))) continue;
    try {
      const folder = prepareSkillFolder(readCatalogFolder(join(catalog, entry.name)));
      if ("error" in folder) throw new Error(folder.error);
      if (folder.skipped.length || folder.parsed.name !== entry.name ||
          !folder.files.some(({ path }) => path === "LICENSE")) {
        throw new Error("catalog name, files or license do not match the package");
      }
      if (previous) {
        if (previous.sha256 !== createHash("sha256").update(folder.skillMd).digest("hex")) continue;
        const archived = retireLibrarySkill(entry.name, previous.sha256, root);
        if ("error" in archived) throw new Error(archived.error);
        if ("stale" in archived) continue;
      }
      const result = installLibrarySkill({
        ...entry,
        instructions: folder.skillMd,
        compatibility: folder.parsed.compatibility,
        warnings: folder.warnings,
        files: folder.files,
        reviewState: "disabled",
        root,
      });
      if ("error" in result) throw new Error(result.error);
      if (previous?.everyBot) {
        const restored = setLibrarySkillEveryBot(entry.name, true, root);
        if ("error" in restored) throw new Error(restored.error);
      }
      installed++;
    } catch (error) {
      failed.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { installed, failed };
}

export function seedStartupBotSkillCatalog(): void {
  try {
    const { installed, failed } = installStartupBotSkillCatalog();
    if (installed) console.log(`[skills-library] added ${installed} catalog skills for review`);
    for (const failure of failed) console.warn(`[skills-library] catalog: ${failure}`);
  } catch (error) {
    console.error(`[skills-library] catalog could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}
