import { createHash } from "node:crypto";
import { chmodSync, constants, copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

const ASIDE_COPIES = 5;

/** A backup failure must leave the original file untouched. */
export function keepUnreadableAside(file: string): string | null {
  try {
    const aside = `${file}.unreadable-${createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 12)}`;
    if (existsSync(aside)) return aside;
    if (readdirSync(dirname(file)).filter((name) => name.startsWith(`${basename(file)}.unreadable-`)).length >= ASIDE_COPIES) return null;
    copyFileSync(file, aside, constants.COPYFILE_EXCL);
    chmodSync(aside, 0o600);
    return aside;
  } catch {
    return null;
  }
}
