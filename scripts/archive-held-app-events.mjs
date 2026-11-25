import { constants } from "node:fs";
import { mkdir, open, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
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
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(folder) {
  if (process.platform === "win32") return;
  const handle = await open(folder, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Archives processed held payloads without changing the closed source or replaying any event. */
export async function archiveHeldAppEvents(profile, workspace, output, archive) {
  if (process.platform === "win32") throw Error("Private archive permissions cannot be guaranteed on Windows. Use a protected Unix environment with a copy of the profile.");
  const [source, work, destination, privateArchive] = await Promise.all([realpath(profile), realpath(workspace), newPath(output), newPath(archive)]);
  if ([source, work].some(root => within(root, destination) || within(root, privateArchive)) || within(destination, privateArchive) || within(privateArchive, destination)) {
    throw Error("Choose new recovery and archive directories outside the profile and workspace.");
  }
  const [rawLedger, rawHeld] = await Promise.all([regularFile(source, ledger), regularFile(source, sidecar)]);
  const parsed = fileSchema.parse(JSON.parse(rawLedger));
  if (!parsed.cursorScope || !Number.isSafeInteger(parsed.cursor) || parsed.heldEvents.some(entry => typeof entry !== "string")) throw Error("The ledger must have a verified account and no embedded event payloads.");
  const held = new Map();
  parseHeldEvents(JSON.parse(rawHeld), held);
  if (!rawHeld.equals(await regularFile(source, sidecar)) || !rawLedger.equals(await regularFile(source, ledger))) throw Error("The profile copy changed while being read.");
  if (!held.size || parsed.heldEvents.some(id => !held.has(id))) throw Error("The held event store is incomplete.");
  const rows = [];
  let archived = 0;
  for (const [id, item] of held) {
    if (item.discarded) { rows.push({ id, ...item }); continue; }
    const event = item.event;
    if (!event || !Number.isSafeInteger(event.seq) || event.seq > parsed.cursor || item.sourceScope !== parsed.cursorScope) throw Error("A held event is not fully checkpointed to the verified account.");
    rows.push({ id, reason: item.reason, event: { seq: event.seq, id, kind: event.kind, triggerId: event.triggerId, receivedAt: event.receivedAt, event: {} },
      discarded: true, eventDigest: eventDigest(event), sourceScope: item.sourceScope,
      ...(item.heldBotIds ? { heldBotIds: item.heldBotIds } : {}), ...(item.heldTriggerIds ? { heldTriggerIds: item.heldTriggerIds } : {}) });
    archived++;
  }
  if (!archived) throw Error("There are no held payloads to archive.");
  if (Buffer.byteLength(JSON.stringify(rows), "utf8") >= 2_000_000) throw Error("Compact receipts would still exceed the held-event storage limit.");
  await mkdir(privateArchive, { mode: 0o700 });
  try {
    await durableFile(path.join(privateArchive, sidecar), rawHeld);
    await durableFile(path.join(privateArchive, ledger), rawLedger);
    await syncDirectory(privateArchive);
    await syncDirectory(path.dirname(privateArchive));
    await mkdir(destination, { mode: 0o700 });
    try {
      await durableFile(path.join(destination, ledger), rawLedger);
      await durableFile(path.join(destination, sidecar), JSON.stringify({ version: 4, events: rows }));
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
