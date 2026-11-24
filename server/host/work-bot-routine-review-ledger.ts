export interface WorkBotRoutineReviewIdentity {
  requestId: string;
  messageId: string;
  botId: string;
  threadId: string;
  actorKey: string;
  operationFingerprint: string;
  conflictFingerprint: string;
  authorityFingerprint: string;
}

type Pending = { identity: Readonly<WorkBotRoutineReviewIdentity>; expiresAt: number };

export class WorkBotRoutineReviewLedger {
  readonly #pending = new Map<string, Pending>();
  readonly #permits = new WeakMap<object, Pending>();
  readonly #now: () => number;
  readonly #ttlMs: number;

  constructor(now: () => number = () => performance.now(), ttlMs = 600_000) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Invalid routine review lifetime");
    this.#now = now;
    this.#ttlMs = ttlMs;
  }

  register(identity: WorkBotRoutineReviewIdentity): void {
    const now = this.#now();
    for (const [id, pending] of this.#pending) if (pending.expiresAt <= now) this.#pending.delete(id);
    if (!Number.isFinite(now) || !validIdentity(identity) || this.#pending.has(identity.requestId) || this.#pending.size >= 1_000) throw new Error("Invalid, duplicate, or unavailable routine review");
    this.#pending.set(identity.requestId, { identity: Object.freeze({ ...identity }), expiresAt: now + this.#ttlMs });
  }

  authorize(identity: WorkBotRoutineReviewIdentity): object | null {
    const pending = this.#pending.get(identity.requestId);
    if (!pending || pending.expiresAt <= this.#now() || !sameIdentity(pending.identity, identity)) return null;
    const permit = Object.freeze({});
    this.#permits.set(permit, pending);
    return permit;
  }

  consume(permit: object, identity: WorkBotRoutineReviewIdentity): boolean {
    const pending = this.#permits.get(permit);
    this.#permits.delete(permit);
    if (!pending || pending.expiresAt <= this.#now() || !sameIdentity(pending.identity, identity) || this.#pending.get(identity.requestId) !== pending) return false;
    this.#pending.delete(identity.requestId);
    return true;
  }

  discard(requestId: string): void { this.#pending.delete(requestId); }
}

function sameIdentity(left: Readonly<WorkBotRoutineReviewIdentity>, right: WorkBotRoutineReviewIdentity): boolean {
  return left.requestId === right.requestId && left.messageId === right.messageId && left.botId === right.botId && left.threadId === right.threadId && left.actorKey === right.actorKey && left.operationFingerprint === right.operationFingerprint && left.conflictFingerprint === right.conflictFingerprint && left.authorityFingerprint === right.authorityFingerprint;
}

function validIdentity(identity: WorkBotRoutineReviewIdentity): boolean {
  return [identity.requestId, identity.messageId, identity.botId, identity.threadId, identity.actorKey].every(value => typeof value === "string" && value.length > 0 && value.length <= 128) && [identity.operationFingerprint, identity.conflictFingerprint, identity.authorityFingerprint].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
}
