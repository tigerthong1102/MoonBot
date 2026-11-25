import { lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileSchema, parseHeldEvents, type HeldEvent } from "./app-trigger-file.ts";
import { readDataFormat } from "./data-format.ts";
import { teamAppEventLedger, type TeamPrivacy } from "./workspace-backup-team-private.ts";
import { writeFileAtomic } from "./atomic.ts";
export { TEAM_APP_EVENT_OMISSION } from "../shared/workspace-backup.ts";

export class WorkspaceAppEventRestoreError extends Error {}

export function recordBlockedAppEventRestore(dataDir: string, id: string, reason: string): void {
  writeFileAtomic(join(dataDir, ".backups", "last-event-restore-blocked.json"), JSON.stringify({ id, reason }), { mode: 0o600 });
}

export function clearBlockedAppEventRestore(dataDir: string): void {
  rmSync(join(dataDir, ".backups", "last-event-restore-blocked.json"), { force: true });
}

export function prepareOrCancelAppEventRestore(dataDir: string, id: string, pending: string, prepare: () => string): { prepared: string } | { result: { restored: false; rolledBack: true; id: string; blockedReason: string } } {
  try { return { prepared: prepare() }; }
  catch (error) {
    if (!(error instanceof WorkspaceAppEventRestoreError)) throw error;
    recordBlockedAppEventRestore(dataDir, id, error.message);
    rmSync(pending, { force: true });
    return { result: { restored: false, rolledBack: true, id, blockedReason: error.message } };
  }
}

export function readBlockedAppEventRestore(dataDir: string): { restored: false; rolledBack: true; id: string; blockedReason: string } | null {
  const file = join(dataDir, ".backups", "last-event-restore-blocked.json");
  if (!exists(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (typeof value.id !== "string" || !/^[0-9a-f-]{36}$/.test(value.id) || typeof value.reason !== "string" || value.reason.length > 1_000) return null;
    return { restored: false, rolledBack: true, id: value.id, blockedReason: value.reason };
  } catch { return null; }
}

export function appEventRoot(name: string): boolean {
  return /^app-triggers\.json(?:\.held)?$/i.test(name) || /^app-triggers\.json(?:\.held)?\.\d+\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.tmp$/i.test(name);
}

export function assertPortableAppEvents(data: string, checkMarker: boolean, read: (path: string) => unknown): void {
  if (checkMarker && (readDataFormat(data, 2)?.format ?? 1) > 1) throw new Error("Workspace backup cannot safely transfer this data format. Keep a protected copy of the closed data folder instead.");
  const get = (name: string) => { const path = join(data, name); return exists(path) ? read(path) : undefined; };
  teamAppEventLedger(get("app-triggers.json"), get("app-triggers.json.held"), { bots: new Set(), threads: new Set() });
}

export function omitTeamAppEvents(data: string, privacy: TeamPrivacy | null, read: (path: string) => unknown): boolean {
  const marker = readDataFormat(data, 2);
  if (marker && marker.format > 2) throw new Error("This data format is newer than this app can back up.");
  if (!privacy) { assertPortableAppEvents(data, true, read); return false; }
  try {
    assertPortableAppEvents(data, true, read);
    const get = (name: string) => { const path = join(data, name); return exists(path) ? read(path) : undefined; };
    teamAppEventLedger(get("app-triggers.json"), get("app-triggers.json.held"), privacy);
    return false;
  } catch { return true; }
}

function exists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export function assertNoDestinationEventFence(dataDir: string): void {
  const main = join(dataDir, "app-triggers.json"), sidecar = join(dataDir, "app-triggers.json.held");
  const blocked = "This destination has held or retired app event receipts. Preserve its closed data folder and restore to another workspace instead.";
  try {
    if ((readDataFormat(dataDir, 2)?.format ?? 1) > 1 || readdirSync(dataDir).some(name => appEventRoot(name) && !["app-triggers.json", "app-triggers.json.held"].includes(name) && !name.endsWith(".tmp"))) throw new Error(blocked);
    if (!exists(main) && !exists(sidecar)) return;
    if (!exists(main) || !lstatSync(main).isFile() || (exists(sidecar) && !lstatSync(sidecar).isFile())) throw new Error(blocked);
    const parsed = JSON.parse(readFileSync(main, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 1 ||
        (parsed.heldEvents !== undefined && (!Array.isArray(parsed.heldEvents) || parsed.heldEvents.length)) || parsed.retiredReceipts !== undefined) throw new Error(blocked);
    if (exists(sidecar)) {
      const held = new Map<string, HeldEvent>();
      parseHeldEvents(JSON.parse(readFileSync(sidecar, "utf8")), held);
      if (held.size) throw new Error(blocked);
    }
  } catch { throw new WorkspaceAppEventRestoreError(blocked); }
}

export function assertOmittedAppEventDestination(dataDir: string): void {
  const main = join(dataDir, "app-triggers.json"), sidecar = join(dataDir, "app-triggers.json.held");
  const blocked = "This destination has app automations or held events that cannot safely follow a different bot roster. Restore to a workspace without existing app automation definitions; its event data will be kept.";
  try {
    if (readdirSync(dataDir).some(name => appEventRoot(name) && !["app-triggers.json", "app-triggers.json.held"].includes(name) && !name.endsWith(".tmp"))) throw new Error(blocked);
    if (!exists(main) && !exists(sidecar)) return;
    if (!exists(main)) throw new Error(blocked);
    if (!lstatSync(main).isFile() || (exists(sidecar) && !lstatSync(sidecar).isFile())) throw new Error(blocked);
    const parsed = fileSchema.parse(JSON.parse(readFileSync(main, "utf8")));
    if (parsed.triggers.length || parsed.deleted.length || parsed.heldEvents.length || parsed.bindingOwners?.length) throw new Error(blocked);
    if (exists(sidecar)) {
      const held = new Map<string, HeldEvent>();
      parseHeldEvents(JSON.parse(readFileSync(sidecar, "utf8")), held);
      if (held.size) throw new Error(blocked);
    }
  } catch { throw new WorkspaceAppEventRestoreError(blocked); }
}
