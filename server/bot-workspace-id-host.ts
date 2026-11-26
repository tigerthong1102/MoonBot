import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createBotWorkspaceIdStore } from "./bot-workspace-id.mjs";
import type { WorkspaceBackupMaintenance } from "./workspace-backup-maintenance.ts";

export function createBotWorkspaceIdHost(options: { directory: string; maintenance: WorkspaceBackupMaintenance; bots(): ReadonlyArray<object> }) {
  return createBotWorkspaceIdStore({ directory: options.directory,
    hasAnchoredBots: () => {
      try {
        const saved: unknown = JSON.parse(readFileSync(join(options.directory, "bots.json"), "utf8"));
        if (!Array.isArray(saved) || saved.some(bot => !bot || typeof bot !== "object" || Array.isArray(bot))) return null;
        return [...saved, ...options.bots()].some(bot => Object.hasOwn(bot, "groupUsername"));
      } catch { return null; }
    },
    acquireOwnerGuard: () => {
      const release = options.maintenance.request();
      return { held: true, release };
    },
  });
}
