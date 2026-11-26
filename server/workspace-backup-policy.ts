import { readlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseStoredConfig } from "./config.ts";
import { inSecretFolder } from "./secret-folder.ts";

export const EXCLUSION_NOTES = [
  "Device pairing, server identity, live leases and runtime files (existing destination identities are preserved).",
  "Saved credentials, provider and MCP connections, managed provider login homes and browser login profiles are not transferred. Destination connections are preserved; reconnect on a new device.",
  "Downloaded tools and caches (they can be installed again), and recorded browser step screenshots (export them from a conversation to keep them).",
  "Installed dependency folders (node_modules) and symbolic links inside conversation work folders; reinstall or recreate them in the project.",
  "External project folders, CLI login homes, browser session homes, OS keychains, companion devices and other servers.",
  "VM/container disk layers and remote cloud data; durable files inside this workspace are included.",
  "Private bot configuration drafts, their test questions and paused workflow runs stay on the original server.",
  "Waits bots set up: they end within a week, so ask the bot again after restoring.",
];
export const RESTORE_WARNING = "Restoring pauses routines, webhooks and calendar calls, ends every wait, and does not resume pending delegations, queued chat messages or queued runs. Definitions and historical receipts are retained; review before enabling them again.";

// Connection sections stay on the destination whole: a restored URL must never redirect an API key kept from that device.
const PORTABLE_CONFIG_KEYS = [
  "profile", "language", "budgets", "billing", "rooms", "threads",
  "localVm", "features", "browserProfiles",
] as const;

export function portableWorkspaceConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid workspace configuration in backup.");
  const config = parseStoredConfig(value as Parameters<typeof parseStoredConfig>[0]);
  return Object.fromEntries(PORTABLE_CONFIG_KEYS.filter((key) => config[key] !== undefined).map((key) => [key, config[key]]));
}

// Computer sharing opens routes and a desktop connector here: a restore never turns it on or off.
const DESTINATION_FEATURES = ["sharedComputers"] as const;

export function restoredWorkspaceConfig(portable: unknown, destination: unknown): Record<string, unknown> {
  if (!destination || typeof destination !== "object" || Array.isArray(destination)) throw new Error("Invalid destination workspace configuration; connections were not changed.");
  const merged = { ...destination } as Record<string, unknown>;
  for (const key of PORTABLE_CONFIG_KEYS) delete merged[key];
  const restored = { ...merged, ...portableWorkspaceConfig(portable) };
  const own = (destination as { features?: Record<string, unknown> }).features ?? {};
  const features: Record<string, unknown> = { ...(restored.features as Record<string, unknown> | undefined) };
  for (const key of DESTINATION_FEATURES) {
    delete features[key];
    if (own[key] !== undefined) features[key] = own[key];
  }
  if (Object.keys(features).length) restored.features = features;
  else delete restored.features;
  return restored;
}

export function excludedWorkspaceAuthPath(path: string): boolean {
  if (inSecretFolder(path)) return true;
  if (/^command-allowlist\.json(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  if (/^mcp-oauth\.json(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // Saved website logins and their key never leave the computer they were saved on, nor does the key sealing webhook secrets.
  if (/^(?:logins\.json\.enc|member-secrets\.json\.enc|logins-key|webhook-key)(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // A Cloud home's connected-apps installation: its connected accounts belong to it, so a copy would share them.
  if (/^connected-apps-installation\.json(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // A Team Cloud's kept rules: a restored Cloud asks the Admin for the ones in force now.
  if (/^team-policy\.json(?:$|\.\d+\.[0-9a-f-]+\.tmp$)/.test(path)) return true;
  // A Team Cloud member's own installation, keys and sign-ins: theirs, never in the team's backup.
  if (/^people-connections(?:\/|$)/.test(path)) return true;
  // A dated copy of the settings file, and the copy of one that could not be understood: they hold the credentials
  // the settings file holds, so they never leave the computer they were taken on.
  if (/^config\.json\.(?:bak\.\d{8}-\d{6}(?:-\d+)?|unreadable-[0-9a-f]{12})(?:\.\d+\.[0-9a-f-]+\.tmp)?$/.test(path)) return true;
  return /^(?:(?:providers|caddy|chrome-profile|\.agent-browser)(?:\/|$)|workspace-credentials\.json$|external-runtimes\.json$|browser-engine-key$)/.test(path) ||
    /^(?:config\.json|webhooks\.json|workspace-credentials\.json|external-runtimes\.json|browser-engine-key|sessions\.json|tunnel-account\.json)\.\d+(?:\.[0-9a-f-]+)?\.tmp$/.test(path) ||
    /^(?:vm-home|vm-homes\/[^/]+)\/\.browser-profiles(?:\/|$)/.test(path);
}

export function redownloadedOrgLibraryPath(path: string): boolean {
  return /^org-library\/(?:catalog\.json(?:\.[0-9a-f-]{36}\.tmp)?$|blobs(?:\/|$))/.test(path);
}

export function ephemeralWorkspaceTokenPath(path: string): boolean {
  // Checkpoints carry single-use approvals and private resolved inputs.
  return /^(?:hook-tokens(?:\/|$)|skill-burger-runs(?:\/|$)|sessions\.json\.open$)/i.test(path);
}

/** Not a consistent snapshot while the engine holds it open (unflushed WAL), and reloadable from its sources. */
export function liveDataEnginePath(path: string): boolean {
  return /^bots\/[^/]+\/(?:data\.duckdb(?:\.wal)?$|data-tmp(?:\/|$))/.test(path);
}

/** Read the link text, never follow it. A link points at the bot's own skill, or at the same-named skill brought in
 * from this computer (imported-skills.ts), which the backup carries. */
export function managedTaskSkillLink(source: string, path: string, roots: string[]): boolean {
  const match = /^task-workspaces\/([^/]+)\/[^/]+\/\.(?:claude|agents|grok)\/skills\/([^/]+)$/.exec(path);
  if (!match) return false;
  let target: string;
  try { target = resolve(dirname(source), readlinkSync(source).replace(/^\\\\\?\\/, "")); } catch { return false; }
  return roots.some((root) => {
    const rel = relative(join(root, "workspaces", match[1], "skills"), target);
    return (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) || relative(join(root, "imported-skills", match[2]), target) === "";
  });
}
