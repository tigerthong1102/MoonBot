import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, open, realpath, rmdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { eventDigest, fileSchema, parseHeldEvents } from "../server/app-trigger-file.ts";

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
  try { await privateDirectory(filename, false, true); await handle.writeFile(content); await handle.sync(); await privateDirectory(filename, false, true); }
  finally { await handle.close(); }
}

const powershell = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:STARTUPBOT_PRIVATE_DIR
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($env:STARTUPBOT_PRIVATE_SETUP -eq '1') {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $path -AclObject $acl
}
$actual = Get-Acl -LiteralPath $path
$rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
$file = $env:STARTUPBOT_PRIVATE_FILE -eq '1'
if ((!$file -and (!$actual.AreAccessRulesProtected -or $rules[0].IsInherited)) -or $actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'Private ACL verification failed' }
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
  } catch { throw Error("Windows private archive ACL could not be established and verified."); }
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
  const parsed = fileSchema.parse(JSON.parse(rawLedger));
  if (!parsed.cursorScope || !Number.isSafeInteger(parsed.cursor) || parsed.heldEvents.some(entry => typeof entry !== "string")) throw Error("The ledger must have a verified account and no embedded event payloads.");
  const held = new Map();
  parseHeldEvents(JSON.parse(rawHeld), held);
  if (!rawHeld.equals(await regularFile(source, sidecar)) || !rawLedger.equals(await regularFile(source, ledger))) throw Error("The profile copy changed while being read.");
  const indexed = parsed.heldEvents;
  if (!held.size || new Set(indexed).size !== indexed.length || indexed.length !== held.size || indexed.some(id => !held.has(id))) throw Error("The held event store does not match its ledger.");
  const rows = [];
  let archived = 0;
  for (const [id, item] of held) {
    if (item.discarded) { rows.push({ id, ...item }); continue; }
    const event = item.event;
    if (!event || !Number.isSafeInteger(event.seq) || event.seq <= 0 || event.seq > parsed.cursor || item.sourceScope !== parsed.cursorScope) throw Error("A held event is not fully checkpointed to the verified account.");
    rows.push({ id, reason: item.reason, event: { seq: event.seq, id, kind: event.kind, triggerId: event.triggerId, receivedAt: event.receivedAt, event: {} },
      discarded: true, eventDigest: eventDigest(event), sourceScope: item.sourceScope,
      ...(item.heldBotIds ? { heldBotIds: item.heldBotIds } : {}), ...(item.heldTriggerIds ? { heldTriggerIds: item.heldTriggerIds } : {}) });
    archived++;
  }
  if (!archived) throw Error("There are no held payloads to archive.");
  if (Buffer.byteLength(JSON.stringify(rows), "utf8") >= 2_000_000) throw Error("Compact receipts would still exceed the held-event storage limit.");
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
      await durableFile(path.join(destination, ledger), rawLedger);
      await privateDirectory(destination);
      await durableFile(path.join(destination, sidecar), JSON.stringify({ version: 4, events: rows }));
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
  return { archived, archive: privateArchive, recovery: destination };
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
