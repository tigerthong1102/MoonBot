import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// All competing workers use the same owner-private local directory. Keep the inode until every worker exits.
export function listenerLeaseFile(directory, accountId) {
  if (typeof accountId !== "string" || !/^[1-9]\d{0,31}$/.test(accountId)) throw new Error("invalid_account");
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || (process.getuid && (parent.uid !== process.getuid() || (parent.mode & 0o077)))) {
    throw new Error("private_local_directory_required");
  }
  const key = createHash("sha256").update("personal:" + accountId).digest("hex");
  const path = join(directory, key + ".lock");
  const fd = openSync(path, constants.O_RDONLY | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || lstatSync(path).isSymbolicLink() ||
        (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) throw new Error("unsafe_lease_file");
  } finally {
    closeSync(fd);
  }
  return path;
}

export function acquireListenerLease(path) {
  const db = new DatabaseSync(path, { timeout: 0, allowExtension: false });
  try {
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
    if (error.errcode === 5 || error.errcode === 6) throw new Error("listener_conflict");
    throw error;
  }
  return () => db.close();
}
