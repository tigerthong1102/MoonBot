import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { ATTACHMENTS_DIR, deleteAttachment, saveFile } from "./attachments.ts";
import type { SavedBotAttachment } from "./bot-attachment.ts";
import { reconciliationCsv, RECONCILIATION_CSV_MAX_BYTES } from "./reconciliation-csv.ts";
import type { Message } from "./store.ts";
import { zipDirectoryLocation, zipMembers } from "./zip-archive.ts";

const required = {
  "report.pdf": "application/pdf",
  "reconciliation.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "sources.csv": "text/csv",
} as const;
export const RECONCILIATION_DELIVERY_PROMPT = "Attach report.pdf (report), reconciliation.xlsx (working papers) and sources.csv (a table identifying the source for each result) with attach_file in the final turn. To create a file in this confined turn, use its exact name and pass its bytes as a data:<mime>;base64,<content> path (up to 256 KiB per file). The report is delivered to the routine’s selected StartupBot conversation. Keep files there for review. External delivery requires a separate request after verification.";

export async function saveReconciliationBytes(path: string, name?: string): Promise<SavedBotAttachment> {
  const invalid = () => Object.assign(new Error("Use a required reconciliation filename and its matching base64 file contents (up to 256 KiB)."), { status: 400 });
  if (!name || !Object.hasOwn(required, name)) throw invalid();
  const artifact = name as keyof typeof required;
  const mime = required[artifact], prefix = "data:" + mime + ";base64,";
  if (!path.startsWith(prefix)) throw invalid();
  const encoded = path.slice(prefix.length);
  if (!encoded || encoded.length > Math.ceil(256 * 1024 / 3) * 4) throw invalid();
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 256 * 1024 || bytes.toString("base64") !== encoded) throw invalid();
  const output = artifact === "sources.csv" ? reconciliationCsv(bytes).bytes : bytes;
  const saved = await saveFile(Readable.from([output]), name, mime, { expectedBytes: output.length });
  if (!usable(ATTACHMENTS_DIR, saved.path, artifact)) {
    deleteAttachment(saved.path);
    throw invalid();
  }
  return { attachment: { kind: "file", name, path: saved.path, mime }, bytes: saved.bytes };
}

export function reconciliationFiles(lines: readonly Message[], turnId: string | undefined) {
  return lines.filter(line => line.role === "bot" && line.kind === "text" && Boolean(turnId) && (line.turnId ?? line.sentInTurn) === turnId)
    .flatMap(line => line.attachments ?? []).filter(file => file.kind === "file" && Object.hasOwn(required, file.name));
}

function usable(root: string, path: string, name: keyof typeof required): boolean {
  if (dirname(resolve(path)) !== resolve(root)) return false;
  let fd: number | undefined;
  try {
    const before = lstatSync(path);
    if (!before.isFile()) return false;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size === 0) return false;
    function read(offset: number, length: number) {
      const buffer = Buffer.alloc(length);
      if (readSync(fd!, buffer, 0, length, offset) !== length) throw new Error("Truncated artifact");
      return buffer;
    }
    if (name === "report.pdf") return read(0, 5).toString("ascii") === "%PDF-" && read(Math.max(0, stat.size - 1024), Math.min(stat.size, 1024)).includes("%%EOF");
    if (name === "sources.csv") return stat.size <= RECONCILIATION_CSV_MAX_BYTES && !reconciliationCsv(read(0, stat.size)).changed;
    const start = Math.max(0, stat.size - 65557);
    const { directoryOffset, directoryBytes, entryCount } = zipDirectoryLocation(read(start, stat.size - start), start, 2048);
    if (directoryBytes > 1024 * 1024 || read(0, 4).readUInt32LE() !== 0x04034b50) return false;
    const names = new Set(zipMembers(read(directoryOffset, directoryBytes), entryCount).map(entry => entry.name));
    return names.has("[Content_Types].xml") && names.has("xl/workbook.xml") && [...names].some(entry => /^xl\/worksheets\/[^/]+\.xml$/.test(entry));
  } catch { return false; }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function incompleteReconciliation(root: string, files: ReturnType<typeof reconciliationFiles>): string | null {
  const missing = Object.entries(required).flatMap(([name, mime]) => {
    const matches = files.filter(file => file.kind === "file" && file.name === name);
    return matches.length === 1 && matches[0]!.mime === mime && usable(root, matches[0]!.path, name as keyof typeof required) ? [] : [name];
  });
  return missing.length ? "Missing or invalid deliverables: " + missing.join(", ") : null;
}
