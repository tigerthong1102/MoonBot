import { z } from "zod";
import type { createZaloInbox, ZaloReceipt } from "./zalo-inbox.ts";
import type { ZaloEvent } from "../shared/zalo-event.ts";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const envelope = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), error_code: z.number().int() }),
]);
const update = z.object({
  event_name: z.literal("message.text.received"),
  message: z.object({
    message_id: id,
    date: z.number().int().min(1).max(8_640_000_000_000_000),
    from: z.object({ id, is_bot: z.boolean() }),
    chat: z.object({ id, chat_type: z.enum(["PRIVATE", "GROUP"]) }),
    text: z.string().min(1).max(8_000),
    message_type: z.literal("CHAT_TEXT").optional(),
  }),
});

type Method = "getMe" | "getWebhookInfo" | "getUpdates";
type Failure = "disabled" | "configuration" | "identity-mismatch" | "webhook-not-found" | "unverified-webhook" | "webhook-configured" |
  "network" | "timeout" | "cancelled" | "protocol" | "authentication" | "access-denied" | "rate-limited" | "poll-in-progress" | "receipt-unknown";

export class ZaloOfficialError extends Error {
  readonly code: Failure;
  constructor(code: Failure) {
    super(code);
    this.code = code;
  }
}

export interface ZaloOfficialGrant {
  /** A fresh enrollment ID on each grant or change of scope. */
  grantId: string;
  accountId: string;
  conversationId: string;
  senderId: string;
}

const polling = new Set<string>();

function requireEnabled() {
  if (process.env.STARTUPBOT_ZALO_OFFICIAL_PILOT !== "1") throw new ZaloOfficialError("disabled");
}

async function boundedPayload(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw new ZaloOfficialError("protocol");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 64 * 1024) throw new ZaloOfficialError("protocol");
      chunks.push(chunk.value);
    }
    return envelope.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    if (signal.aborted) throw new ZaloOfficialError(signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled");
    throw new ZaloOfficialError("protocol");
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function failure(code: number, method: Method): Failure {
  if (code === 404 && method === "getWebhookInfo") return "webhook-not-found";
  if (code === 401) return "authentication";
  if (code === 403 || code === 422) return "access-denied";
  if (code === 429) return "rate-limited";
  return "protocol";
}

function officialClient(token: string, request: typeof fetch) {
  if (!/^\d{1,32}:[A-Za-z0-9_-]{1,256}$/.test(token)) {
    throw new ZaloOfficialError("configuration");
  }
  async function call(method: Method, signal?: AbortSignal) {
    requireEnabled();
    if (signal?.aborted) throw new ZaloOfficialError("cancelled");
    const deadline = AbortSignal.timeout(method === "getUpdates" ? 35_000 : 5_000);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response: Response;
    try {
      response = await request(`https://bot-api.zaloplatforms.com/bot${token}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, redirect: "error",
        body: JSON.stringify(method === "getUpdates" ? { timeout: "30" } : {}),
        signal: requestSignal,
      });
    } catch {
      // Provider URLs contain the bot token.
      if (requestSignal.aborted) throw new ZaloOfficialError(deadline.aborted ? "timeout" : "cancelled");
      throw new ZaloOfficialError("network");
    }
    if (!response.ok && !(response.status === 408 && method === "getUpdates")) {
      await response.body?.cancel().catch(() => {});
      throw new ZaloOfficialError(failure(response.status, method));
    }
    const payload = await boundedPayload(response, requestSignal);
    if (!payload.ok) {
      if (method === "getUpdates" && payload.error_code === 408 && (response.ok || response.status === 408)) return null;
      throw new ZaloOfficialError(failure(payload.error_code, method));
    }
    if (!response.ok || payload.result == null) throw new ZaloOfficialError("protocol");
    return payload.result;
  }

  async function probe(expectedId?: string, signal?: AbortSignal) {
    const identity = z.object({ id, account_name: z.string().min(1).max(128).optional().catch(undefined) }).safeParse(await call("getMe", signal));
    if (!identity.success) throw new ZaloOfficialError("protocol");
    const accountId = identity.data.id;
    if (expectedId !== undefined && accountId !== expectedId) throw new ZaloOfficialError("identity-mismatch");
    const info = { accountId, ...(identity.data.account_name ? { accountName: identity.data.account_name } : {}) };
    try {
      const webhook = z.object({ url: z.string() }).safeParse(await call("getWebhookInfo", signal));
      if (!webhook.success) throw new ZaloOfficialError("unverified-webhook");
      return { ...info, webhookConfigured: webhook.data.url !== "" };
    } catch (error) {
      if (!(error instanceof ZaloOfficialError) || error.code === "disabled" || error.code === "cancelled") throw error;
      return { ...info, webhookConfigured: null, webhookError: error.code };
    }
  }

  return { probe, call };
}

export const probeZaloOfficialToken = (token: string, signal?: AbortSignal, request: typeof fetch = fetch) =>
  officialClient(token, request).probe(undefined, signal);

export function createZaloOfficialReader(accountId: string, token: string, request: typeof fetch = fetch) {
  if (!id.safeParse(accountId).success) throw new ZaloOfficialError("configuration");
  const client = officialClient(token, request);
  const probe = (signal?: AbortSignal) => client.probe(accountId, signal);
  return {
    probe,
    async receiveOnce(options: {
      grant: () => Readonly<ZaloOfficialGrant> | undefined;
      /** Recheck grantId and persist or deduplicate the event atomically before returning. */
      accept: (event: ZaloEvent, grantId: string) => ZaloReceipt;
      signal?: AbortSignal;
    }) {
      requireEnabled();
      const grant = options.grant();
      if (!grant || grant.accountId !== accountId || !id.safeParse(grant.grantId).success ||
          !id.safeParse(grant.conversationId).success || !id.safeParse(grant.senderId).success) return "revoked";
      const initial = { ...grant };
      const isCurrent = () => {
        const current = options.grant();
        return current?.grantId === initial.grantId && current?.accountId === accountId &&
          current.conversationId === initial.conversationId && current.senderId === initial.senderId;
      };
      if (polling.has(accountId)) throw new ZaloOfficialError("poll-in-progress");
      polling.add(accountId);
      try {
        const status = await probe(options.signal);
        if (status.webhookConfigured === null) throw new ZaloOfficialError(status.webhookError);
        if (status.webhookConfigured) throw new ZaloOfficialError("webhook-configured");
        if (!isCurrent() || options.signal?.aborted) return "revoked";
        const payload = await client.call("getUpdates", options.signal);
        requireEnabled();
        if (!isCurrent() || options.signal?.aborted) return "revoked";
        if (payload === null) return "idle";
        const parsed = update.safeParse(payload);
        if (!parsed.success) {
          const type = z.object({ event_name: z.string() }).safeParse(payload);
          if (!type.success || type.data.event_name === "message.text.received") throw new ZaloOfficialError("protocol");
          return "ignored";
        }
        const { message } = parsed.data;
        if (message.from.is_bot || message.chat.chat_type !== "PRIVATE") return "ignored";
        if (message.chat.id !== initial.conversationId || message.from.id !== initial.senderId) return "ignored";
        try {
          return options.accept({
            adapter: "official", accountId, conversationId: message.chat.id, conversationType: "direct",
            senderId: message.from.id, messageId: message.message_id, timestamp: message.date,
            direction: "incoming", text: message.text,
          }, initial.grantId);
        } catch {
          throw new ZaloOfficialError("receipt-unknown");
        }
      } finally {
        polling.delete(accountId);
      }
    },
  };
}

export async function receiveOfficialIntoInbox(reader: ReturnType<typeof createZaloOfficialReader>,
  inbox: ReturnType<typeof createZaloInbox>, grantId: string, signal?: AbortSignal) {
  requireEnabled();
  if (inbox.grant(grantId)?.adapter !== "official") return "revoked";
  const lease = inbox.beginOfficialPoll(grantId);
  if (!lease) return inbox.grant(grantId) ? "poll-in-progress" : "revoked";
  let observed = false;
  try {
    const result = await reader.receiveOnce({
      grant: () => inbox.grant(grantId),
      accept: (event, epoch) => inbox.accept(event, epoch, lease),
      signal,
    });
    observed = result === "persisted" || result === "duplicate" || result === "idle" || result === "ignored";
    return result;
  } finally {
    inbox.finishOfficialPoll(lease, observed);
  }
}
