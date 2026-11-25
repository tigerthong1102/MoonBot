import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, open, realpath, rmdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { eventDigest, fileSchema, parseHeldEvents, retiredEventKey } from "../server/app-trigger-file.ts";
import { heldEventMatches, isEventHoldProblem } from "../server/app-trigger-held.ts";

const ledger = "app-triggers.json";
const sidecar = `${ledger}.held`;

async function regularFile(folder, name) {
  const filename = path.join(folder, name);
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await handle.stat()).isFile() || await realpath(filename) !== filename) throw Error("Use ordinary files from a closed profile copy.");
    return await handle.readFile();
  } finally { await handle.close(); }
}

function within(folder, candidate) {
  const relative = path.relative(folder, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function newPath(value) {
  const resolved = path.resolve(value);
  return path.join(await realpath(path.dirname(resolved)), path.basename(resolved));
}

async function durableFile(filename, content) {
  const handle = await open(filename, "wx", 0o600);
  try { await privateDirectory(filename, true, true); await handle.writeFile(content); await handle.sync(); await privateDirectory(filename, false, true); }
  finally { await handle.close(); }
}

const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:STARTUPBOT_PRIVATE_DIR
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$file = $env:STARTUPBOT_PRIVATE_FILE -eq '1'
if ($env:STARTUPBOT_PRIVATE_SETUP -eq '1') {
  $acl = if ($file) { New-Object System.Security.AccessControl.FileSecurity } else { New-Object System.Security.AccessControl.DirectorySecurity }
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = if ($file) { 'None' } else { 'ContainerInherit, ObjectInherit' }
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inherit, 'None', 'Allow')
  $acl.AddAccessRule($rule)
  if ($file) { [System.IO.File]::SetAccessControl($path, $acl) } else { [System.IO.Directory]::SetAccessControl($path, $acl) }
}
$actual = if ($file) { [System.IO.File]::GetAccessControl($path) } else { [System.IO.Directory]::GetAccessControl($path) }
$rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if (!$actual.AreAccessRulesProtected -or $rules.Count -ne 1) { exit 21 }
if ($actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { exit 22 }
if ($rules[0].IsInherited -or $rules[0].IdentityReference.Value -ne $sid.Value) { exit 23 }
if ($rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { exit 24 }
`;

async function privateDirectory(folder, setup = false, file = false) {
  if (process.platform !== "win32") return;
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw Error("Windows security service is unavailable.");
  const executable = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  try {
    await promisify(execFile)(executable, ["-NoProfile", "-NonInteractive", "-Command", powershell], {
      env: { ...process.env, STARTUPBOT_PRIVATE_DIR: folder, STARTUPBOT_PRIVATE_SETUP: setup ? "1" : "0", STARTUPBOT_PRIVATE_FILE: file ? "1" : "0" }, timeout: 20_000, windowsHide: true,
    });
  } catch (error) {
    const reason = { 21: "unexpected rule count or inheritance", 22: "unexpected owner", 23: "unexpected principal", 24: "unexpected access rights" }[error.code];
    throw Error("Windows private archive ACL could not be established and verified" + (reason ? " (" + reason + ")." : "."));
  }
}

async function protectedParent(folder) {
  if (process.platform === "win32") return privateDirectory(folder);
  const mode = (await stat(folder)).mode;
  if ((mode & 0o022) && !(mode & 0o1000)) throw Error("Choose a parent directory that is not shared or writable by others.");
}

async function syncDirectory(folder) {
  if (process.platform === "win32") return;
  const handle = await open(folder, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Archives processed held payloads without changing the closed source or replaying any event. */
export async function archiveHeldAppEvents(profile, workspace, output, archive) {
  const [source, work, destination, privateArchive] = await Promise.all([realpath(profile), realpath(workspace), newPath(output), newPath(archive)]);
  if ([source, work].some(root => within(root, destination) || within(root, privateArchive)) || within(destination, privateArchive) || within(privateArchive, destination)) {
    throw Error("Choose new recovery and archive directories outside the profile and workspace.");
  }
  await protectedParent(path.dirname(destination));
  await protectedParent(path.dirname(privateArchive));
  const [rawLedger, rawHeld] = await Promise.all([regularFile(source, ledger), regularFile(source, sidecar)]);
  const document = JSON.parse(rawLedger);
  const parsed = fileSchema.parse(document);
  if (!parsed.cursorScope || !Number.isSafeInteger(parsed.cursor) || parsed.heldEvents.some(entry => typeof entry !== "string")) throw Error("The ledger must have a verified account and no embedded event payloads.");
  const held = new Map();
  parseHeldEvents(JSON.parse(rawHeld), held);
  if (!rawHeld.equals(await regularFile(source, sidecar)) || !rawLedger.equals(await regularFile(source, ledger))) throw Error("The profile copy changed while being read.");
  const indexed = parsed.heldEvents;
  if (!held.size || new Set(indexed).size !== indexed.length || indexed.length !== held.size || indexed.some(id => !held.has(id))) throw Error("The held event store does not match its ledger.");
  const retired = new Map(Object.entries(parsed.retiredReceipts ?? {}));
  for (const [id, item] of held) {
    const event = item.event;
    if (!event || !Number.isSafeInteger(event.seq) || event.seq <= 0 || event.seq > parsed.cursor || item.sourceScope !== parsed.cursorScope) throw Error("A held event is not fully checkpointed to the verified account.");
    if (item.discarded && (!item.eventDigest || Object.keys(event.event).length)) throw Error("A held event receipt is incomplete.");
    const key = retiredEventKey(item.sourceScope, id);
    const digest = item.discarded ? item.eventDigest : eventDigest(event);
    if (retired.has(key) && retired.get(key) !== digest) throw Error("A saved event receipt conflicts with the archive.");
    retired.set(key, digest);
  }
  const receipts = [...held.values()];
  const clearResolved = (raw, stored) => {
    if (!isEventHoldProblem(stored.problem) || !receipts.some(item => heldEventMatches(item, stored))) return raw;
    const { problem: _problem, ...kept } = raw;
    return kept;
  };
  const recovered = { ...document, version: 2, heldEvents: [], retiredReceipts: Object.fromEntries(retired),
    triggers: document.triggers.map((row, index) => clearResolved(row, parsed.triggers[index])),
    ...(Array.isArray(document.deleted) ? { deleted: document.deleted.map((row, index) => ({ ...row, trigger: clearResolved(row.trigger, parsed.deleted[index].trigger) })) } : {}) };
  fileSchema.parse(recovered);
  await mkdir(privateArchive, { mode: 0o700 });
  try {
    await privateDirectory(privateArchive, true);
    await durableFile(path.join(privateArchive, sidecar), rawHeld);
    await privateDirectory(privateArchive);
    await durableFile(path.join(privateArchive, ledger), rawLedger);
    await privateDirectory(privateArchive);
    await syncDirectory(privateArchive);
    await syncDirectory(path.dirname(privateArchive));
    await mkdir(destination, { mode: 0o700 });
    try {
      await privateDirectory(destination, true);
      await durableFile(path.join(destination, ledger), JSON.stringify(recovered));
      await privateDirectory(destination);
      await durableFile(path.join(destination, sidecar), JSON.stringify({ version: 4, events: [] }));
      await privateDirectory(destination);
      await syncDirectory(destination);
      await syncDirectory(path.dirname(destination));
    } catch (error) {
      await Promise.allSettled([unlink(path.join(destination, ledger)), unlink(path.join(destination, sidecar))]);
      await rmdir(destination).catch(() => {});
      throw error;
    }
  } catch (error) {
    throw new Error(`Recovery could not be completed. A private archive may remain at ${privateArchive}.`, { cause: error });
  }
  return { archived: held.size, archive: privateArchive, recovery: destination };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { profile: { type: "string" }, workspace: { type: "string" }, output: { type: "string" }, archive: { type: "string" } } });
    if (!values.profile || !values.workspace || !values.output || !values.archive) throw Error("Use --profile CLOSED_COPY --workspace WORKSPACE --output NEW_DIRECTORY --archive NEW_PRIVATE_DIRECTORY");
    const result = await archiveHeldAppEvents(values.profile, values.workspace, values.output, values.archive);
    process.stdout.write(`Archived ${result.archived} held events. Keep the private archive safe; test the recovery files in a separate profile copy.\n`);
  } catch (error) {
    process.stderr.write((error instanceof SyntaxError || error.name === "ZodError" ? "Invalid data in the profile copy." : error.message) + "\n");
    process.exitCode = 1;
  }
}
