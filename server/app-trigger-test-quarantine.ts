import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

const MAX_ENTRIES = 4096;
const MAX_BYTES = 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const entrySchema = z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), remote: z.string().regex(/^[a-f0-9]{64}$/), seq: z.number().int().nonnegative().safe(), at: z.number().int().nonnegative().safe() }).strict();
const fileSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(MAX_ENTRIES) }).strict().superRefine(({ entries }, context) => {
  if (new Set(entries.map(entry => entry.key)).size !== entries.length) context.addIssue({ code: "custom", message: "Duplicate quarantined event" });
});
type Entry = z.infer<typeof entrySchema>;

export class AppTriggerTestQuarantine {
  private entries: Entry[] = [];
  private unreadable = false;
  private readonly file: string;
  private readonly now: () => number;
  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    let fd: number | undefined;
    try {
      if (!lstatSync(file).isFile()) throw new Error("Invalid quarantine");
      fd = openSync(file, process.platform === "win32" ? "r" : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Invalid quarantine");
      this.entries = fileSchema.parse(JSON.parse(readFileSync(fd, "utf8"))).entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.unreadable = true;
    } finally { if (fd !== undefined) closeSync(fd); }
  }

  record(input: { eventId: string; remoteId: string; seq: number }): void {
    if (this.unreadable) throw new Error("Test event quarantine cannot be read");
    if (!input.eventId || input.eventId.length > 512 || !input.remoteId || input.remoteId.length > 512 || !Number.isSafeInteger(input.seq) || input.seq < 0) throw new Error("Invalid test event identity");
    const key = hash(JSON.stringify([input.eventId, input.remoteId, input.seq]));
    if (this.entries.some(entry => entry.key === key)) return;
    const entries = fileSchema.parse({ version: 1, entries: [...this.entries, { key, remote: hash(input.remoteId), seq: input.seq, at: this.now() }] }).entries;
    const payload = JSON.stringify({ version: 1, entries });
    if (Buffer.byteLength(payload) > MAX_BYTES) throw new Error("Test event quarantine is full");
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, payload, { mode: 0o600 });
    this.entries = entries;
  }

  count(): number {
    if (this.unreadable) throw new Error("Test event quarantine cannot be read");
    return this.entries.length;
  }
}
