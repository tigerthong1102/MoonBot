import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { normalizedOfficialText, readZaloOfficialEnvelope } from "../../../server/zalo-official.ts";
import { classifyZaloText } from "../../../shared/zalo-intelligence.ts";
import type { ZaloEvent } from "../../../shared/zalo-event.ts";
import { openLabJournal } from "./journal.ts";
import { claimLabAccount } from "./receipts.ts";

export const SAMPLE = "Anh cần đối soát công nợ gấp.";
export const REPLY = "StartupBot đã phân loại mẫu kiểm thử là yêu cầu đối soát công nợ khẩn.";
const FLAG = "--confirm-one-private-test-reply";
const WINDOW = 120_000;

export async function runOfficialRoundtrip(options: {
  accountId: string; token: string; db: DatabaseSync; announce: (challenge: string) => void;
  request?: typeof fetch; signal?: AbortSignal;
}) {
  const { accountId, token, db, announce, request = fetch } = options;
  if (process.env.STARTUPBOT_ZALO_OFFICIAL_PILOT !== "1" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(accountId) ||
      !/^\d{1,32}:[a-zA-Z0-9_-]{1,256}$/.test(token)) return "disabled-or-unconfigured";
  const started = Date.now();
  const deadline = started + WINDOW;
  const timeout = AbortSignal.timeout(WINDOW);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const lease = claimLabAccount(db, accountId, started, deadline + 15_000);
  if (!lease) return "blocked-by-prior-run";
  type Method = "getMe" | "getWebhookInfo" | "getUpdates" | "sendMessage";
  async function call(method: Method, body: object = {}) {
    signal.throwIfAborted();
    if (Date.now() >= deadline || process.env.STARTUPBOT_ZALO_OFFICIAL_PILOT !== "1") throw Error();
    const perRequest = AbortSignal.any([signal, AbortSignal.timeout(method === "getUpdates" ? 20_000 : 5_000)]);
    const response = await request(`https://bot-api.zaloplatforms.com/bot${token}/${method}`, {
      method: "POST", redirect: "error", signal: perRequest, headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw Error();
    }
    const payload = await readZaloOfficialEnvelope(response, perRequest);
    perRequest.throwIfAborted();
    if (payload.ok && (payload.error_code === undefined || payload.error_code === 0) && payload.result != null) return payload.result;
    if (!payload.ok && payload.result == null) {
      if (method === "getUpdates" && payload.error_code === 408) return null;
      if (method === "getWebhookInfo" && payload.error_code === 404 && typeof payload.description === "string" &&
          payload.description.trim().toLowerCase() === "not found") return null;
    }
    throw Error();
  }
  async function checkWebhook() {
    const result = await call("getWebhookInfo");
    return result === null || z.object({ url: z.literal("") }).safeParse(result).success;
  }
  let armed = false;
  try {
    if (!z.object({ id: z.literal(accountId) }).safeParse(await call("getMe")).success) return "identity-mismatch";
    const challenge = "STARTUPBOT-QA-" + randomBytes(18).toString("base64url");
    let paired: ZaloEvent | undefined;
    for (let i = 0; i < 10; i++) {
      if (!await checkWebhook()) return "webhook-blocked";
      if (i === 0) announce(challenge);
      const payload = await call("getUpdates", { timeout: "15" });
      if (payload === null) continue;
      const event = normalizedOfficialText(accountId, payload);
      if (!event || event.timestamp < started - 60_000 || event.timestamp > Date.now() + 60_000) return "unexpected-update";
      if (!paired) {
        if (event.text !== challenge) return "unexpected-update";
        paired = event;
        continue;
      }
      if (event.conversationId !== paired.conversationId || event.senderId !== paired.senderId ||
          event.messageId === paired.messageId || event.timestamp < paired.timestamp || event.text !== SAMPLE) return "unexpected-update";
      const result = classifyZaloText(event.text);
      if (!result.urgent || result.intents.length !== 1 || result.intents[0] !== "reconciliation") return "classification-failed";
      if (!await checkWebhook()) return "webhook-blocked";
      signal.throwIfAborted();
      const confirm = lease.arm(event.conversationId, event.senderId, event.messageId, Date.now());
      if (!confirm) return "blocked-by-prior-run";
      armed = true;
      const receipt = await call("sendMessage", { chat_id: event.conversationId, text: REPLY });
      if (!z.object({ message_id: z.string().trim().min(1).max(128) }).safeParse(receipt).success) return "delivery-unknown";
      confirm();
      return "provider-acknowledged";
    }
    return "poll-limit";
  } catch {
    return armed ? "delivery-unknown" : "stopped";
  } finally {
    lease.release();
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== FLAG || !process.stdin.isTTY || !process.stdout.isTTY ||
      process.env.STARTUPBOT_ZALO_OFFICIAL_PILOT !== "1") {
    process.stderr.write("Cần terminal tương tác, bật pilot và xác nhận một phản hồi thử.\n");
    process.exitCode = 2;
    return;
  }
  process.umask(0o077);
  const db = openLabJournal(homedir());
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const status = await runOfficialRoundtrip({
      accountId: process.env.STARTUPBOT_ZALO_OFFICIAL_ACCOUNT_ID ?? "",
      token: process.env.STARTUPBOT_ZALO_OFFICIAL_BOT_TOKEN ?? "",
      db, signal: controller.signal,
      announce(challenge) {
        process.stdout.write(`Gửi lần lượt hai tin nhắn sau trong cùng chat riêng với bot thử nghiệm:\n${challenge}\n${SAMPLE}\n`);
      },
    });
    process.stdout.write(status + "\n");
    if (status !== "provider-acknowledged") process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(() => { process.stderr.write("stopped\n"); process.exitCode = 1; });
}
