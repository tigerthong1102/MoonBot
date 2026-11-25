import { constants } from "node:fs";
import { mkdir, open, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

const ledger = "app-triggers.json";
const sidecar = ledger + ".held";

async function readSnapshotFile(folder, name, optional = false) {
  const filename = path.join(folder, name);
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (!(await handle.stat()).isFile() || await realpath(filename) !== filename) throw Error("Use a closed snapshot with ordinary files.");
    return await handle.readFile();
  } catch (error) {
    if (optional && error.code === "ENOENT") return undefined;
    throw error;
  } finally { await handle?.close(); }
}

/** Builds a new pair of recovery files from two trusted, closed snapshots. Neither source is modified. */
export async function recoverAppEventAccount(profile, trustedBackup, output) {
  const [source, backup] = await Promise.all([realpath(profile), realpath(trustedBackup)]);
  if (source === backup) throw Error("Select separate original and verified snapshots.");
  const destination = path.join(await realpath(path.dirname(path.resolve(output))), path.basename(output));
  for (const folder of [source, backup]) {
    const relative = path.relative(folder, destination);
    if (!relative || !(relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))) throw Error("Choose an output outside both source snapshots.");
  }

  const [unscoped, scoped, latestHeld, verifiedHeld] = await Promise.all([
    readSnapshotFile(source, ledger), readSnapshotFile(backup, ledger),
    readSnapshotFile(source, sidecar, true), readSnapshotFile(backup, sidecar, true),
  ]);
  const saved = JSON.parse(unscoped), verified = JSON.parse(scoped);
  if (saved?.version !== 1 || !Array.isArray(saved.triggers) || !/^[A-Za-z0-9_-]{8,64}$/.test(saved.pollerId ?? "") ||
      !Number.isSafeInteger(saved.cursor) || saved.cursor < 0 || Object.hasOwn(saved, "cursorScope")) throw Error("Source must be an unverified version 1 automation ledger.");
  if (typeof verified?.cursorScope !== "string" || !/^[a-f0-9]{64}$/.test(verified.cursorScope)) throw Error("The trusted backup has no verified connected-app account.");
  const { cursorScope: _scope, ...verifiedState } = verified;
  if (!isDeepStrictEqual(saved, verifiedState) || !isDeepStrictEqual(latestHeld, verifiedHeld)) {
    throw Error("The saved automations, pending events or position differ between the snapshots.");
  }

  await mkdir(destination, { mode: 0o700 });
  try {
    await writeFile(path.join(destination, ledger), scoped, { flag: "wx", mode: 0o600 });
    if (verifiedHeld) await writeFile(path.join(destination, sidecar), verifiedHeld, { flag: "wx", mode: 0o600 });
  } catch (error) {
    await Promise.allSettled([unlink(path.join(destination, ledger)), unlink(path.join(destination, sidecar))]);
    await rmdir(destination).catch(() => {});
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { profile: { type: "string" }, "trusted-backup": { type: "string" }, output: { type: "string" } } });
    if (!values.profile || !values["trusted-backup"] || !values.output) throw Error("Use --profile CLOSED_COPY --trusted-backup VERIFIED_CLOSED_COPY --output NEW_DIRECTORY");
    await recoverAppEventAccount(values.profile, values["trusted-backup"], values.output);
    process.stdout.write("Matching recovery files were written to the new directory. Test them in a separate closed profile copy.\n");
  } catch (error) {
    const reason = error instanceof SyntaxError ? "Invalid JSON in a snapshot." : error.message;
    process.stderr.write(reason + "\n");
    process.exitCode = 1;
  }
}
