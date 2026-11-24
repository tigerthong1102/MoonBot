import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

const RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_RECEIPTS = 4096;
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const entrySchema = z.object({
  id: z.string().uuid(), actor: z.string().min(1).max(200), requestKey: z.string().uuid(), botId: z.string().min(1).max(200),
  triggerId: z.string().min(1).max(200), remoteId: z.string().min(1).max(200), accountId: z.string().min(1).max(200),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), createdAt: z.number().int().nonnegative().safe(), reviewAfter: z.number().int().nonnegative().safe(),
  eventId: z.string().regex(/^test_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/).optional(),
  reason: z.enum(["filtered", "paused", "revoked", "missing", "queue-full", "quota"]).optional(),
  state: z.enum(["reserved", "sending", "processing", "handled", "rejected", "cancelled"]), runId: z.string().min(1).max(200).optional(),
}).strict();
const journalSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(MAX_RECEIPTS) }).strict().superRefine(({ entries }, context) => {
  const ids = new Set<string>(), keys = new Set<string>(), hashes = new Set<string>(), events = new Set<string>(), active = new Set<string>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.actor, entry.requestKey]);
    const open = entry.state === "reserved" || entry.state === "sending" || entry.state === "processing";
    if (ids.has(entry.id) || keys.has(key) || (entry.tokenHash && hashes.has(entry.tokenHash)) || (entry.eventId && events.has(entry.eventId)) || (open && active.has(entry.triggerId))
      || entry.reviewAfter < entry.createdAt || (entry.state === "reserved" && entry.tokenHash) || ((entry.state === "sending" || entry.state === "processing") && !entry.tokenHash)
      || ((entry.state === "reserved" || entry.state === "sending") && entry.eventId) || ((entry.state === "processing" || entry.state === "handled") && !entry.eventId)
      || (entry.state === "handled" && (!entry.tokenHash || !entry.runId)) || (entry.state !== "handled" && entry.runId)
      || (entry.state === "rejected" && !entry.reason) || (entry.state !== "rejected" && entry.reason)) {
      context.addIssue({ code: "custom", message: "Invalid test request journal" });
      return;
    }
    ids.add(entry.id); keys.add(key);
    if (entry.tokenHash) hashes.add(entry.tokenHash);
    if (entry.eventId) events.add(entry.eventId);
    if (open) active.add(entry.triggerId);
  }
});
type Entry = z.infer<typeof entrySchema>;
type Identity = Pick<Entry, "actor" | "requestKey" | "botId" | "triggerId" | "remoteId" | "accountId">;
export type TestReceipt = Pick<Entry, "id" | "triggerId" | "createdAt" | "reviewAfter" | "state" | "runId" | "reason">;
export type TestReceiptBinding = Pick<Entry, "actor" | "botId" | "triggerId" | "remoteId" | "accountId">;

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const visible = (entry: Entry): TestReceipt => ({ id: entry.id, triggerId: entry.triggerId, createdAt: entry.createdAt, reviewAfter: entry.reviewAfter, state: entry.state, ...(entry.runId ? { runId: entry.runId } : {}), ...(entry.reason ? { reason: entry.reason } : {}) });
const binding = (entry: Entry): TestReceiptBinding => ({ actor: entry.actor, botId: entry.botId, triggerId: entry.triggerId, remoteId: entry.remoteId, accountId: entry.accountId });

export class AppTriggerTestReceipts {
  private entries: Entry[];
  private unreadable = false;
  private readonly file: string;
  private readonly now: () => number;
  private readonly permits = new WeakMap<object, string>();
  private readonly pendingAdmissions = new Set<string>();

  constructor(file: string, now: () => number = Date.now, options: { requireExisting?: boolean } = {}) {
    this.file = file;
    this.now = now;
    let fd: number | undefined;
    try {
      if (!lstatSync(file).isFile()) throw new Error("Invalid test request journal");
      fd = openSync(file, process.platform === "win32" ? "r" : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_JOURNAL_BYTES) throw new Error("Invalid test request journal");
      this.entries = journalSchema.parse(JSON.parse(readFileSync(fd, "utf8"))).entries;
    }
    catch (error) {
      this.entries = [];
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || options.requireExisting) this.unreadable = true;
    } finally { if (fd !== undefined) closeSync(fd); }
  }

  private commit(entries: Entry[]): void {
    if (this.unreadable) throw new Error("Test request receipts cannot be read");
    const checked = journalSchema.parse({ version: 1, entries });
    const payload = JSON.stringify(checked);
    if (Buffer.byteLength(payload) > MAX_JOURNAL_BYTES) throw new Error("Test request receipts are full");
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, payload, { mode: 0o600 });
    this.entries = checked.entries;
  }

  reserve(identity: Identity): { receipt: TestReceipt; created: boolean } {
    if (this.unreadable) throw new Error("Test request receipts cannot be read");
    const at = this.now();
    if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(at + RETENTION_MS)) throw new Error("Invalid test request time");
    const identityCheck = entrySchema.pick({ actor: true, requestKey: true, botId: true, triggerId: true, remoteId: true, accountId: true }).parse(identity);
    const existing = this.entries.find(entry => entry.actor === identityCheck.actor && entry.requestKey === identityCheck.requestKey);
    if (existing) {
      if (existing.botId !== identity.botId || existing.triggerId !== identity.triggerId || existing.remoteId !== identity.remoteId || existing.accountId !== identity.accountId) throw new Error("Test request key belongs to another operation");
      return { receipt: visible(existing), created: false };
    }
    const pending = this.entries.find(entry => entry.triggerId === identity.triggerId && (entry.state === "reserved" || entry.state === "sending" || entry.state === "processing"));
    if (pending) throw new Error("A test request is already pending");
    if (this.entries.length >= MAX_RECEIPTS) throw new Error("Too many test request receipts");
    const entry: Entry = { ...identityCheck, id: randomUUID(), createdAt: at, reviewAfter: at + RETENTION_MS, state: "reserved" };
    this.commit([...this.entries, entry]);
    return { receipt: visible(entry), created: true };
  }

  begin(actor: string, id: string): { receipt: TestReceipt; token: string } | null {
    if (this.unreadable) throw new Error("Test request receipts cannot be read");
    const index = this.entries.findIndex(entry => entry.id === id && entry.actor === actor);
    if (index < 0 || this.entries[index]!.state !== "reserved") return null;
    const token = randomBytes(32).toString("base64url");
    const next: Entry = { ...this.entries[index]!, state: "sending", tokenHash: digest(token) };
    const entries = [...this.entries]; entries[index] = next;
    this.commit(entries);
    return { receipt: visible(next), token };
  }

  find(actor: string, id: string): TestReceipt | null {
    if (this.unreadable) throw new Error("Test request receipts cannot be read");
    const entry = this.entries.find(item => item.id === id && item.actor === actor);
    return entry ? visible(entry) : null;
  }

  cancelUnclaimed(actor: string, id: string): TestReceipt | null {
    if (this.unreadable) throw new Error("Test request receipts cannot be read");
    const index = this.entries.findIndex(entry => entry.id === id && entry.actor === actor);
    if (index < 0) return null;
    const entry = this.entries[index]!;
    if (entry.state !== "reserved" && entry.state !== "sending") return null;
    const next: Entry = { ...entry, state: "cancelled" };
    const entries = [...this.entries]; entries[index] = next;
    this.commit(entries);
    return visible(next);
  }

  inspect(token: string, remoteId: string): { receipt: TestReceipt; binding: TestReceiptBinding; eventId?: string } | null {
    if (this.unreadable) throw new Error("Test request receipts cannot be read");
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = digest(token);
    const entry = this.entries.find(item => item.tokenHash === hash && item.remoteId === remoteId);
    return entry ? { receipt: visible(entry), binding: binding(entry), ...(entry.eventId ? { eventId: entry.eventId } : {}) } : null;
  }

  processingForReconciliation(): Array<{ receipt: TestReceipt; binding: TestReceiptBinding; eventId: string }> {
    if (this.unreadable) throw new Error("Test request receipts cannot be read");
    return this.entries.flatMap(entry => entry.state === "processing" && entry.eventId ? [{ receipt: visible(entry), binding: binding(entry), eventId: entry.eventId }] : []);
  }

  hasPending(): boolean {
    if (this.unreadable) throw new Error("Test request receipts cannot be read");
    return this.entries.some(entry => entry.state === "reserved" || entry.state === "sending" || entry.state === "processing");
  }

  claim(token: string, remoteId: string, eventId: string): { receipt: TestReceipt; binding: TestReceiptBinding; eventId: string; fresh: boolean; sameEvent: boolean; permit?: object } | null {
    if (this.unreadable) throw new Error("Test request receipts cannot be read");
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^test_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(eventId)) return null;
    const hash = digest(token);
    const index = this.entries.findIndex(item => item.tokenHash === hash && item.remoteId === remoteId);
    if (index < 0) return null;
    const entry = this.entries[index]!;
    if (entry.state === "cancelled") return { receipt: visible(entry), binding: binding(entry), eventId, fresh: false, sameEvent: false };
    if (entry.state !== "sending") return entry.eventId ? { receipt: visible(entry), binding: binding(entry), eventId: entry.eventId, fresh: false, sameEvent: entry.eventId === eventId } : null;
    const next: Entry = { ...entry, state: "processing", eventId };
    const entries = [...this.entries]; entries[index] = next;
    this.commit(entries);
    const permit = Object.freeze({});
    this.permits.set(permit, next.id);
    this.pendingAdmissions.add(next.id);
    return { receipt: visible(next), binding: binding(next), eventId, fresh: true, sameEvent: true, permit };
  }

  beginAdmission(permit: object): boolean {
    const id = this.permits.get(permit);
    if (!id) return false;
    this.permits.delete(permit);
    this.pendingAdmissions.delete(id);
    return this.entries.some(entry => entry.id === id && entry.state === "processing");
  }

  rejectBeforeAdmission(permit: object, reason: NonNullable<Entry["reason"]>): TestReceipt | null {
    const id = this.permits.get(permit);
    if (!id) return null;
    const index = this.entries.findIndex(entry => entry.id === id && entry.state === "processing");
    if (index < 0) return null;
    const next: Entry = { ...this.entries[index]!, state: "rejected", reason };
    const entries = [...this.entries]; entries[index] = next;
    this.commit(entries);
    this.permits.delete(permit);
    this.pendingAdmissions.delete(id);
    return visible(next);
  }

  settle(id: string, state: "handled" | "rejected" | "cancelled", runId?: string): TestReceipt | null {
    if (this.unreadable) throw new Error("Test request receipts cannot be read");
    const index = this.entries.findIndex(entry => entry.id === id);
    if (index < 0) return null;
    const previous = this.entries[index]!;
    if (this.pendingAdmissions.has(id)) throw new Error("The test request has not reached admission");
    if (previous.state !== "reserved" && previous.state !== "sending" && previous.state !== "processing") {
      if (previous.state !== state || previous.runId !== runId) throw new Error("Test request result conflicts with its receipt");
      return visible(previous);
    }
    if (previous.state === "reserved" && state !== "cancelled") throw new Error("An unsent test request cannot have a result");
    if (previous.state === "sending" || (previous.state === "processing" && state !== "handled")) throw new Error("A sent test request has an uncertain outcome");
    if (state === "handled" && !runId) throw new Error("A handled test request needs a run");
    if (state !== "handled" && runId) throw new Error("An unhandled test request cannot have a run");
    const next: Entry = { ...previous, state, ...(runId ? { runId } : {}) };
    const entries = [...this.entries]; entries[index] = next;
    this.commit(entries);
    return visible(next);
  }
}
