import { createHash } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function syncDirectory(dir) {
  if (process.platform === "win32") return;
  const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function secureDirectory(dir) {
  mkdirSync(dir, { mode: 0o700, recursive: true });
  const stat = lstatSync(dir);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))
  )
    throw Error("exact_journal_unavailable");
}
export function exactReplyJournal(directory) {
  function scoped(owner, origin) {
    if (!uuid.test(owner) || new URL(origin).origin !== origin || !origin.startsWith("https://"))
      throw Error("exact_journal_unavailable");
    secureDirectory(directory);
    syncDirectory(dirname(directory));
    const dir = join(
      directory,
      createHash("sha256")
        .update(JSON.stringify([origin, owner]))
        .digest("hex"),
    );
    secureDirectory(dir);
    syncDirectory(directory);
    return dir;
  }
  function file(ref) {
    if (!uuid.test(ref.id)) throw Error("exact_journal_unavailable");
    return join(scoped(ref.owner, ref.origin), ref.id);
  }
  return {
    hasPending() {
      try {
        return readdirSync(directory, { withFileTypes: true }).some(
          (d) =>
            d.isDirectory() &&
            /^[a-f0-9]{64}$/.test(d.name) &&
            readdirSync(join(directory, d.name)).some((id) => uuid.test(id)),
        );
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    },
    add(ref) {
      const fd = openSync(file(ref), "wx", 0o600);
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      syncDirectory(scoped(ref.owner, ref.origin));
    },
    list(owner, origin) {
      return readdirSync(scoped(owner, origin)).map((id) => {
        if (!uuid.test(id)) throw Error("exact_journal_unavailable");
        return { owner, origin, id };
      });
    },
    remove(ref) {
      try {
        unlinkSync(file(ref));
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
      syncDirectory(scoped(ref.owner, ref.origin));
    },
  };
}
