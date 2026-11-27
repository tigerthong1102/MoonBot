import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Kind = "pdf" | "xlsx";
export const DOCUMENT_BYTES = 4 * 1024 * 1024;
const checked = new Set<string>();
const key = (kind: Kind, bytes: Buffer) => kind + ":" + createHash("sha256").update(bytes).digest("hex");
const source = new URL("./reconciliation-document.worker.ts", import.meta.url);
const worker = fileURLToPath(existsSync(source) ? source : new URL("./reconciliation-document.worker.js", import.meta.url));
const options = {
  timeout: 15_000, maxBuffer: 1024, windowsHide: true,
  env: { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
};
function args(kind: Kind) { return ["--max-old-space-size=128", "--disable-warning=ExperimentalWarning", worker, kind]; }
function remember(digest: string) {
  if (checked.size >= 128) checked.delete(checked.values().next().value!);
  checked.add(digest);
}
function refused(kind: Kind) {
  return Object.assign(new Error(kind === "pdf" ? "Use a static report.pdf without interactive actions, embedded files or forms (up to 4 MiB)." : "Use a value-only reconciliation.xlsx with numeric totals and plain source references. Formulas, external relationships and embedded content cannot be delivered (up to 4 MiB)."), { status: 400 });
}

export async function verifyReconciliationDocument(kind: Kind, bytes: Buffer): Promise<void> {
  if (!bytes.length || bytes.length > DOCUMENT_BYTES) throw refused(kind);
  const digest = key(kind, bytes);
  if (checked.has(digest)) return;
  await new Promise<void>((resolve, reject) => {
    const child = execFile(process.execPath, args(kind), options, error => error ? reject(refused(kind)) : resolve());
    child.stdin?.on("error", () => reject(refused(kind)));
    child.stdin?.end(bytes);
  });
  remember(digest);
}

export function verifiedReconciliationDocument(kind: Kind, bytes: Buffer): boolean {
  if (!bytes.length || bytes.length > DOCUMENT_BYTES) return false;
  const digest = key(kind, bytes);
  if (checked.has(digest)) return true;
  const result = spawnSync(process.execPath, args(kind), { ...options, input: bytes });
  if (result.status !== 0) return false;
  remember(digest);
  return true;
}
