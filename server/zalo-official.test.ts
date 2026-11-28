import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createZaloOfficialReader, type ZaloOfficialGrant } from "./zalo-official.ts";

const enrollment = { grantId: "consent-1", accountId: "12345", conversationId: "chat-a", senderId: "person-a" };
const event = {
  event_name: "message.text.received",
  message: { from: { id: "person-a", is_bot: false }, chat: { id: "chat-a", chat_type: "PRIVATE" },
    message_id: "msg-1", date: 1_765_000_000_000, text: "Chiều mai đối chiếu công nợ nhé.", avatar: "private-extra" },
};
const success = (result: unknown) => Response.json({ ok: true, result });
function fixture(responses: (() => Response | Promise<Response>)[] = []) {
  const token = "12345:fixture-only";
  const methods: string[] = [];
  const request: typeof fetch = async (input, init) => {
    expect(init?.redirect).toBe("error");
    const target = new URL(String(input));
    expect(target.origin).toBe("https://bot-api.zaloplatforms.com");
    expect(target.pathname.split("/")[1]).toBe("bot" + token);
    methods.push(target.pathname.split("/")[2]);
    const next = responses.shift();
    if (next) return next();
    throw Error("unexpected request " + token);
  };
  const accept = vi.fn(() => "persisted" as const);
  let grant: ZaloOfficialGrant | undefined = { ...enrollment };
  const reader = createZaloOfficialReader(enrollment.accountId, token, request);
  return { methods, accept, reader, receive: () => reader.receiveOnce({ grant: () => grant, accept }),
    replaceGrant: (value?: ZaloOfficialGrant) => { grant = value; } };
}
const identity = () => success({ id: enrollment.accountId });
const noWebhook = () => success({ url: "" });
beforeEach(() => vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1"));
afterEach(() => vi.unstubAllEnvs());

it("probes identity and webhook status without consuming events or returning secret URLs", async () => {
  const { reader, methods } = fixture([identity, () => success({ url: "https://example.test/private-token" })]);
  expect(await reader.probe()).toEqual({ accountId: "12345", webhookConfigured: true });
  expect(methods).toEqual(["getMe", "getWebhookInfo"]);
});

it("requires a scoped enrollment and explicit server enablement", async () => {
  const f = fixture();
  f.replaceGrant();
  expect(await f.receive()).toBe("revoked");
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "");
  await expect(f.reader.probe()).rejects.toMatchObject({ code: "disabled" });
  expect(f.methods).toEqual([]);
});

it("stores only normalized incoming private text under the verified bot and enrollment", async () => {
  const f = fixture([identity, noWebhook, () => success(event)]);
  expect(await f.receive()).toBe("persisted");
  expect(f.accept.mock.calls).toEqual([[{
    adapter: "official", accountId: "12345", conversationId: "chat-a", conversationType: "direct", senderId: "person-a",
    messageId: "msg-1", timestamp: event.message.date, text: event.message.text, direction: "incoming",
  }, "consent-1"]]);
  expect(f.methods).toEqual(["getMe", "getWebhookInfo", "getUpdates"]);
});

it.each([
  ["group", { ...event, message: { ...event.message, chat: { id: "chat-a", chat_type: "GROUP" } } }],
  ["different sender", { ...event, message: { ...event.message, from: { id: "someone", is_bot: false } } }],
  ["different chat", { ...event, message: { ...event.message, chat: { id: "elsewhere", chat_type: "PRIVATE" } } }],
  ["bot", { ...event, message: { ...event.message, from: { id: "person-a", is_bot: true } } }],
  ["unsupported", { ...event, event_name: "message.unsupported.received" }],
  ["attachment", { ...event, event_name: "message.file.received" }],
])("drops %s before delivery", async (_, input) => {
  const f = fixture([identity, noWebhook, () => success(input)]);
  expect(await f.receive()).toBe("ignored");
  expect(f.accept).not.toHaveBeenCalled();
});

it("keeps existing webhooks and refuses unverified account or configuration", async () => {
  for (const [responses, code] of [
    [[() => success({ id: "other" })], "identity-mismatch"],
    [[identity, () => success({ url: "https://example.test/" })], "webhook-configured"],
    [[identity, () => success({})], "unverified-webhook"],
    [[identity, () => Response.json({ ok: false, error_code: 404 })], "protocol"],
  ] as const) {
    const f = fixture([...responses]);
    await expect(f.receive()).rejects.toMatchObject({ code });
    expect(f.methods).not.toContain("getUpdates");
    expect(f.methods).not.toContain("deleteWebhook");
  }
});

it("rechecks revocation and same-scope reenrollment during a long poll", async () => {
  const f = fixture([identity, noWebhook, () => {
    f.replaceGrant({ ...enrollment, grantId: "consent-2" });
    return success(event);
  }]);
  expect(await f.receive()).toBe("revoked");
  expect(f.accept).not.toHaveBeenCalled();
});

it("prevents two simultaneous in-process polls for one account", async () => {
  let resume!: (response: Response) => void;
  const first = fixture([() => new Promise(resolve => { resume = resolve; }), noWebhook,
    () => Response.json({ ok: false, error_code: 408 })]);
  const pending = first.receive();
  const second = fixture();
  await expect(second.receive()).rejects.toMatchObject({ code: "poll-in-progress" });
  expect(second.methods).toEqual([]);
  resume(identity());
  expect(await pending).toBe("idle");
});

it("redacts transport errors and refuses oversized and malformed success replies", async () => {
  for (const [response, code] of [
    [() => { throw Error("provider url with a private token"); }, "network"],
    [() => new Response("z".repeat(70_000)), "protocol"],
    [() => Response.json({ ok: false, error_code: 401, description: "private token" }), "authentication"],
    [() => Response.json({ ok: false, error_code: 429 }), "rate-limited"],
    [() => Response.json({ ok: true, result: null }), "protocol"],
  ] as const) {
    const f = fixture([response]);
    await expect(f.receive()).rejects.toMatchObject({ code, message: code });
  }
});

it("hands ambiguous persistence to the operator without fetching or sending again", async () => {
  const f = fixture([identity, noWebhook, () => success(event)]);
  f.accept.mockImplementationOnce(() => { throw Error("private event"); });
  await expect(f.receive()).rejects.toMatchObject({ code: "receipt-unknown" });
  expect(f.methods).toEqual(["getMe", "getWebhookInfo", "getUpdates"]);
});

it("flags incomplete text updates as protocol gaps without persisting or executing them", async () => {
  const f = fixture([identity, noWebhook, () => success({ event_name: event.event_name, text: "read my files" })]);
  await expect(f.receive()).rejects.toMatchObject({ code: "protocol" });
  expect(f.accept).not.toHaveBeenCalled();
});
