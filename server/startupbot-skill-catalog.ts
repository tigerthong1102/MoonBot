import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { isSkillName } from "../shared/skill-md.ts";
import { prepareSkillFolder, type SkillFolderFile } from "./skill-folder.ts";
import { installLibrarySkill, readSkillLibraryIndex, skillsLibraryRoot } from "./skill-library.ts";

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
    if (Object.hasOwn(existing, entry.name)) continue;
    try {
      const folder = prepareSkillFolder(readCatalogFolder(join(catalog, entry.name)));
      if ("error" in folder) throw new Error(folder.error);
      if (folder.skipped.length || folder.parsed.name !== entry.name ||
          !folder.files.some(({ path }) => path === "LICENSE")) {
        throw new Error("catalog name, files or license do not match the package");
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
      installed++;
    } catch (error) {
      failed.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { installed, failed };
}
