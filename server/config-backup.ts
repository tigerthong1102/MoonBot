// A failed read of config.json must never authorize overwriting credentials or connections.
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { parseJson, type JsonObject } from "./schema.ts";
import { keepUnreadableAside } from "./unreadable-aside.ts";

export const CONFIG_BACKUP_PREFIX = "config.json.bak.";
export const CONFIG_BACKUP_KEEP = 10;

const BACKUP_NAME = /^config\.json\.bak\.(\d{8})-(\d{6})(?:-(\d+))?$/;

export interface ConfigBackup {
  name: string;
  path: string;
  stamp: string;
  bytes: number;
}

export type ConfigFileRead =
  | { state: "missing" }
  | { state: "ok"; value: JsonObject; text: string }
  | { state: "unreadable"; reason: string }
  | { state: "invalid"; reason: string };

function backupOrder(name: string): { stamp: string; order: number } {
  const match = BACKUP_NAME.exec(name)!;
  return { stamp: `${match[1]}-${match[2]}`, order: match[3] ? Number(match[3]) : 0 };
}

/** An unreadable settings file must never be treated as empty or overwritten by a save. */
export function readConfigFile(path: string): ConfigFileRead {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
    return { state: "unreadable", reason: error instanceof Error ? error.message : "unable to read the file" };
  }
  try {
    const value = parseJson(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { state: "invalid", reason: "it is not a JSON object" };
    return { state: "ok", value: value as JsonObject, text };
  } catch {
    // A JSON error can quote the file, and the file holds credentials.
    return { state: "invalid", reason: "it is not valid JSON" };
  }
}

export function configSaveRefusal(read: { state: "unreadable" | "invalid"; reason: string }, path: string): Error {
  const why = read.state === "invalid" ? `it is not a settings file (${read.reason})` : `it could not be read (${read.reason})`;
  const aside = read.state === "invalid" ? keepUnreadableAside(path) : null;
  const kept = aside ? ` A copy of it was kept at ${aside}.` : "";
  return Object.assign(
    new Error(`The settings file ${path} was left as it is because ${why}, so nothing was saved. Repair the file, or put a dated copy back with "openmausbot config restore".${kept}`),
    { status: 503 },
  );
}

export function configBackupRefusal(path: string): Error {
  return Object.assign(
    new Error(`The settings file ${path} was left as it is because its dated copy could not be written, so nothing was saved.`),
    { status: 503 },
  );
}

function stampOf(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

export function writeConfigBackup(path: string, text: string, now: Date = new Date(), skip?: string): string | null {
  const dir = dirname(path);
  const base = CONFIG_BACKUP_PREFIX + stampOf(now);
  let taken = 0;
  for (const copy of listConfigBackups(dir)) {
    if (copy.name.startsWith(base)) taken = Math.max(taken, backupOrder(copy.name).order + 1);
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = taken === 0 ? base : `${base}-${taken}`;
    taken += 1;
    if (name === skip) continue;
    const target = join(dir, name);
    if (existsSync(target)) continue;
    try {
      writeFileAtomic(target, text, { mode: 0o600 });
    } catch {
      return null;
    }
    pruneConfigBackups(dir, name);
    return name;
  }
  return null;
}

export function listConfigBackups(dir: string): ConfigBackup[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => BACKUP_NAME.test(name))
    .sort((one, two) => {
      const first = backupOrder(one);
      const second = backupOrder(two);
      if (first.stamp !== second.stamp) return first.stamp < second.stamp ? -1 : 1;
      return first.order - second.order;
    })
    .map((name) => {
      const path = join(dir, name);
      let bytes = 0;
      try {
        bytes = statSync(path).size;
      } catch {
      }
      return { name, path, stamp: backupOrder(name).stamp, bytes };
    });
}

function pruneConfigBackups(dir: string, justWritten: string): void {
  const copies = listConfigBackups(dir);
  // A corrected clock may put this save before every existing timestamp. The
  // copy that makes the imminent overwrite reversible must survive retention.
  const removable = copies.filter((copy) => copy.name !== justWritten);
  for (const copy of removable.slice(0, Math.max(0, copies.length - CONFIG_BACKUP_KEEP))) {
    try {
      unlinkSync(copy.path);
    } catch {
    }
  }
}

export type ConfigRestore = { ok: true; name: string; kept: string | null; restored: boolean } | { ok: false; error: string };

export type ConfigBackupCheck = (text: string) => string | null;

/** A restore must preserve replaced settings and refuse to overwrite a file it cannot read or back up. */
export function restoreConfigBackup(dir: string, name: string, options: { dryRun?: boolean; check?: ConfigBackupCheck } = {}): ConfigRestore {
  if (!BACKUP_NAME.test(name)) return { ok: false, error: `${name} is not a dated copy of the settings file; run openmausbot config backups to see the copies` };
  const source = join(dir, name);
  let text: string;
  try {
    text = readFileSync(source, "utf8");
  } catch {
    return { ok: false, error: `The copy ${name} could not be read; run openmausbot config backups to see the copies` };
  }
  try {
    const parsed = parseJson(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: `The copy ${name} is not a settings file, so it was not put back` };
  } catch {
    return { ok: false, error: `The copy ${name} is not valid JSON, so it was not put back` };
  }
  const problem = options.check?.(text);
  if (problem) return { ok: false, error: `The copy ${name} is not a settings file (${problem}), so it was not put back` };
  const target = join(dir, "config.json");
  const current = readConfigFile(target);
  if (current.state === "unreadable") return { ok: false, error: `The file ${target} could not be read, so it was left as it is and nothing was put back` };
  if (options.dryRun) return { ok: true, name, kept: null, restored: false };
  let kept: string | null = null;
  if (current.state === "ok") {
    const copy = writeConfigBackup(target, current.text, new Date(), name);
    if (!copy) return { ok: false, error: `The file ${target} could not be kept as a dated copy, so it was left as it is and nothing was put back` };
    kept = join(dir, copy);
  } else if (current.state === "invalid") {
    const aside = keepUnreadableAside(target);
    if (!aside) return { ok: false, error: `The file ${target} could not be kept as a copy, so it was left as it is and nothing was put back` };
    kept = aside;
  }
  try {
    writeFileAtomic(target, text, { mode: 0o600 });
  } catch {
    return { ok: false, error: `The copy ${name} could not be written to ${target}${kept ? `; the previous file was kept at ${kept}` : ""}` };
  }
  return { ok: true, name, kept, restored: true };
}
