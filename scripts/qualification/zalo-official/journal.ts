import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, type Stats } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

function privateToOwner(stat: Stats, forbidden: number) {
  return !process.getuid || (stat.uid === process.getuid() && (stat.mode & forbidden) === 0);
}

function validateFile(stat: Stats) {
  if (!stat.isFile() || stat.nlink !== 1 || !privateToOwner(stat, 0o077)) throw Error("unsafe-journal");
}

export function openLabJournal(home: string) {
  const ownerHome = lstatSync(home);
  if (!ownerHome.isDirectory() || !privateToOwner(ownerHome, 0o022)) throw Error("unsafe-home");
  let folder = home;
  for (const part of [".startupbot-qualification", "zalo-official"]) {
    folder = join(folder, part);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const stat = lstatSync(folder);
    if (!stat.isDirectory() || !privateToOwner(stat, 0o077)) throw Error("unsafe-directory");
  }
  const path = join(folder, "receipts.sqlite");
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const stat = lstatSync(path + suffix, { throwIfNoEntry: false });
    if (stat) validateFile(stat);
  }
  const fd = openSync(path, constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0), 0o600);
  try {
    const stat = fstatSync(fd);
    validateFile(stat);
    const visible = lstatSync(path);
    validateFile(visible);
    if (visible.dev !== stat.dev || visible.ino !== stat.ino) throw Error("unsafe-journal");
    return new DatabaseSync(path, { allowExtension: false });
  } finally {
    closeSync(fd);
  }
}
