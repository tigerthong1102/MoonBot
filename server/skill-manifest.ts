import { z } from "zod";
import { githubSkillOriginSchema, skillFolderRecordSchema } from "./skill-folder.ts";

const skillManifestEntrySchema = z.object({
  maintenancePinned: z.boolean().optional(),
  archivedFrom: z.object({ enabled: z.boolean(), revision: z.string().max(129) }).optional(),
  description: z.string(),
  enabled: z.boolean(),
  source: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.string(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  warnings: z.array(z.string()),
  skippedFiles: z.array(z.string()),
  referencesSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  ...skillFolderRecordSchema,
  github: githubSkillOriginSchema.optional(),
  appliedStageId: z.string().optional(),
  storageRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  package: z.object({
    installId: z.string().regex(/^[a-f0-9]{32}$/),
    key: z.string().min(1).max(64),
    release: z.string().min(1).max(40),
    r: z.string().regex(/^[a-f0-9]{64}$/),
    w: z.string().regex(/^[a-f0-9]{64}$/),
    via: z.literal("preset").optional(),
  }).optional(),
});
export const skillManifestSchema = z.record(z.string(), skillManifestEntrySchema);

export type SkillManifestEntry = z.infer<typeof skillManifestEntrySchema>;
export type SkillManifest = z.infer<typeof skillManifestSchema>;
export type SkillPackageStamp = NonNullable<SkillManifestEntry["package"]>;
