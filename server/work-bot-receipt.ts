import { createHash, randomBytes } from "node:crypto";
import type { ResolvedSender } from "../shared/wire.ts";
import type { DirectSendInput, DirectSendReceipt } from "./direct-send.ts";
import type { FollowUp } from "../shared/follow-up.ts";

export function workBotReceiptFingerprint(salt: string, text: string, sender: ResolvedSender | undefined, triggerKind: string | undefined, followUp?: FollowUp): string {
  return createHash("sha256").update(JSON.stringify([salt, text, sender?.id ?? sender?.name ?? null, triggerKind ?? null, followUp ?? null])).digest("hex");
}

export function newWorkBotReceipt(text: string, sender: ResolvedSender | undefined, triggerKind: string | undefined, threadId: string, messageId: string, sourceMessageId: string, followUp?: FollowUp) {
  const salt = randomBytes(16).toString("hex");
  return { text: "", transfer: { threadId, messageId, sourceMessageId, salt, fingerprint: workBotReceiptFingerprint(salt, text, sender, triggerKind, followUp) } };
}

export function transferredWorkBotReceipt(input: DirectSendInput, lookup: (botId: string, threadId: string, sendId: string) => { id: string; salt: string; fingerprint: string } | null): DirectSendReceipt | null {
  const { botId, threadId, sendId, text, sender, trigger, replyTo, dataContext, app, via, callId, mentions, followUp } = input;
  if (!sendId) return null;
  const transferred = lookup(botId, threadId, sendId);
  if (!transferred) return null;
  if (!transferred.salt || !transferred.fingerprint) throw Object.assign(new Error("The transferred message cannot be verified; do not resend it automatically"), { status: 409 });
  if (replyTo || dataContext || app || via || callId || mentions?.length || transferred.fingerprint !== workBotReceiptFingerprint(transferred.salt, text, sender, trigger.kind, followUp)) throw Object.assign(new Error("sendId already belongs to another message"), { status: 409 });
  return { ok: true, transferred: true, queueId: transferred.id, threadId };
}
