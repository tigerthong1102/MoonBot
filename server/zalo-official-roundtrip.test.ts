import { spawnSync } from "node:child_process";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openLabJournal } from "../scripts/qualification/zalo-official/journal.ts";
import { REPLY, runOfficialRoundtrip, SAMPLE } from "../scripts/qualification/zalo-official/roundtrip.ts";

const accountId = "900091";
const token = "900091:lab-fixture";
const success = (result: unknown) => Response.json({ ok: true, result });
const idle = () => Response.json({ ok: false, error_code: 408 });
const absent = () => Response.json({ ok: false, error_code: 404, description: "Not Found" });
const message = (text: string, id: string, extra = {}) => success({ event_name: "message.text.received", message: {
  message_id: id, date: Date.now(), from: { id: "test-sender", is_bot: false },
  chat: { id: "test-chat", chat_type: "PRIVATE" }, text, ...extra,
} });
const close: DatabaseSync[] = [];
const files: string[] = [];
function open(path = ":memory:") {
  const db = new DatabaseSync(path);
  close.push(db);
  return db;
}
function fixture(options: {
  db?: DatabaseSync; webhook?: () => Response; identity?: () => Response;
  updates?: ((challenge: string) => Response)[]; send?: () => Response; signal?: AbortSignal;
}) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const challenges: string[] = [];
  const updates = options.updates ?? [idle, code => message(code, "fixture-challenge-id"), () => message(SAMPLE, "fixture-sample-id")];
  const db = options.db ?? open();
  const request: typeof fetch = async (input, init) => {
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    const url = new URL(String(input));
    expect(url.origin).toBe("https://bot-api.zaloplatforms.com");
    const method = url.pathname.split("/").at(-1)!;
    calls.push(method);
    switch (method) {
      case "getMe": return (options.identity ?? (() => success({ id: accountId })))();
      case "getWebhookInfo": return (options.webhook ?? absent)();
      case "getUpdates": return updates.shift()?.(challenges.at(-1)!) ?? idle();
      case "sendMessage":
        bodies.push(JSON.parse(String(init?.body)));
        return (options.send ?? (() => success({ message_id: "fixture-receipt" })))();
      default: throw Error();
    }
  };
  return { calls, bodies, challenges, run: () => runOfficialRoundtrip({
    accountId, token, db, signal: options.signal, request, announce: code => { challenges.push(code); },
  }) };
}
beforeEach(() => vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "1"));
afterEach(() => {
  vi.unstubAllEnvs();
  for (const db of close.splice(0)) db.close();
  for (const folder of files.splice(0)) rmSync(folder, { recursive: true, force: true });
});

it.each([absent, () => success({ url: "" }), () => Response.json({ ok: false, error_code: 404, description: " not found " })])(
  "pairs once on a verified dedicated bot and acknowledges one classified sample", async webhook => {
    const f = fixture({ webhook });
    expect(await f.run()).toBe("provider-acknowledged");
    expect(f.calls).toEqual(["getMe", "getWebhookInfo", "getUpdates", "getWebhookInfo", "getUpdates",
      "getWebhookInfo", "getUpdates", "getWebhookInfo", "sendMessage"]);
    expect(f.bodies).toEqual([{ chat_id: "test-chat", text: REPLY }]);
    expect(f.challenges).toEqual([expect.stringMatching(/^STARTUPBOT-QA-[-\w]{24}$/)]);
  },
);

it.each([
  () => new Response(null, { status: 404 }), () => success({ url: "https://example.invalid/active" }),
  () => Response.json({ ok: false, error_code: 404 }), () => Response.json({ ok: false, error_code: 404, description: "route missing" }),
  () => Response.json({ ok: false, error_code: 404, description: "Not Found", result: { url: "https://example.invalid" } }),
  () => Response.json({ ok: false, error_code: 404, description: "Not Found" }, { status: 202 }),
  () => new Response(null, { status: 429 }), () => success({}),
  () => Response.json({ ok: true, error_code: 500, result: { url: "" } }),
])("stops before polling on an active or unexpected webhook result", async webhook => {
  const f = fixture({ webhook });
  await f.run();
  expect(f.calls).toEqual(["getMe", "getWebhookInfo"]);
  expect(f.challenges).toEqual([]);
});

it("stops before pairing on an identity mismatch and stops before sending if a webhook appears", async () => {
  const f = fixture({ identity: () => success({ id: "another-bot" }) });
  expect(await f.run()).toBe("identity-mismatch");
  expect(f.calls).toEqual(["getMe"]);
  let checks = 0;
  const changed = fixture({ webhook: () => ++checks === 4 ? success({ url: "https://example.invalid/active" }) : absent() });
  expect(await changed.run()).toBe("webhook-blocked");
  expect(changed.bodies).toEqual([]);
});

it.each([
  () => message(SAMPLE, "fixture-sample-id", { from: { id: "another-sender", is_bot: false } }),
  () => message(SAMPLE, "fixture-sample-id", { from: { id: "test-sender", is_bot: true } }),
  () => message(SAMPLE, "fixture-sample-id", { chat: { id: "another-chat", chat_type: "PRIVATE" } }),
  () => message(SAMPLE, "fixture-sample-id", { chat: { id: "test-chat", chat_type: "GROUP" } }),
  () => message("arbitrary text", "fixture-sample-id"), () => message(SAMPLE, "fixture-challenge-id"),
  () => message(SAMPLE, "fixture-sample-id", { date: Date.now() - 120_000 }),
  () => message(SAMPLE, "fixture-sample-id", { date: Date.now() + 120_000 }),
  () => Response.json({ ok: false, error_code: 401 }),
  () => Response.json({ ok: false, error_code: 408 }, { status: 408 }),
])("requires two distinct fresh private messages with the exact sample and sender", async second => {
  const f = fixture({ updates: [code => message(code, "fixture-challenge-id"), second] });
  expect(await f.run()).not.toBe("provider-acknowledged");
  expect(f.bodies).toEqual([]);
});

it("rejects an unsolicited sample and ends polling within the attempt limit", async () => {
  const unsolicited = fixture({ updates: [() => message(SAMPLE, "fixture-challenge-id")] });
  expect(await unsolicited.run()).toBe("unexpected-update");
  expect(unsolicited.bodies).toEqual([]);
  const f = fixture({ updates: [] });
  expect(await f.run()).toBe("poll-limit");
  expect(f.calls.filter(m => m === "getUpdates")).toHaveLength(10);
  expect(f.bodies).toEqual([]);
});

it.each([() => { throw Error(token); }, () => success({}), () => new Response(null, { status: 502 })])(
  "never retries an unknown send even when a second process opens the receipt database", async send => {
    const path = mkdtempSync(join(tmpdir(), "zalo-lab-"));
    files.push(path);
    const file = join(path, "receipts.sqlite");
    const f = fixture({ db: open(file), send });
    expect(await f.run()).toBe("delivery-unknown");
    expect(f.bodies).toHaveLength(1);
    const next = fixture({ db: open(file) });
    expect(await next.run()).toBe("blocked-by-prior-run");
    expect(next.calls).toEqual([]);
    const stored = readFileSync(file);
    for (const raw of [token, accountId, "test-chat", "test-sender", "fixture-challenge-id", "fixture-sample-id", SAMPLE, REPLY, ...f.challenges]) {
      expect(stored.includes(Buffer.from(raw))).toBe(false);
    }
  },
);

it("fences concurrent consumers and a previously acknowledged sample", async () => {
  const db = open();
  const first = fixture({ db });
  const concurrent = fixture({ db });
  const running = first.run();
  expect(await concurrent.run()).toBe("blocked-by-prior-run");
  expect(concurrent.calls).toEqual([]);
  expect(await running).toBe("provider-acknowledged");
  const replay = fixture({ db });
  expect(await replay.run()).toBe("blocked-by-prior-run");
  expect(replay.bodies).toEqual([]);
  expect(replay.challenges[0]).not.toBe(first.challenges[0]);
});

it("honors cancellation before sending, and rejects disabled and noninteractive CLI use", async () => {
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal, updates: [code => message(code, "fixture-challenge-id"), () => {
    controller.abort();
    return message(SAMPLE, "fixture-sample-id");
  }] });
  expect(await f.run()).toBe("stopped");
  expect(f.bodies).toEqual([]);
  vi.stubEnv("STARTUPBOT_ZALO_OFFICIAL_PILOT", "");
  const disabled = fixture({});
  expect(await disabled.run()).toBe("disabled-or-unconfigured");
  expect(disabled.calls).toEqual([]);
  const result = spawnSync(process.execPath, ["scripts/qualification/zalo-official/roundtrip.ts", "--confirm-one-private-test-reply"],
    { env: { STARTUPBOT_ZALO_OFFICIAL_PILOT: "1" }, encoding: "utf8" });
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
});

function labHome() {
  const home = mkdtempSync(join(tmpdir(), "lab-home-"));
  files.push(home);
  return home;
}

it("opens a journal in the owner's private home and refuses linked directories or hardlinked SQLite files", () => {
  const home = labHome();
  openLabJournal(home).close();
  const redirected = labHome();
  symlinkSync(home, join(redirected, ".startupbot-qualification"), process.platform === "win32" ? "junction" : "dir");
  expect(() => openLabJournal(redirected)).toThrow();
  const target = join(home, ".startupbot-qualification", "zalo-official", "receipts.sqlite");
  linkSync(target, join(home, "second-link"));
  expect(() => openLabJournal(home)).toThrow();
});

it.skipIf(!process.getuid)("rejects POSIX directories writable by others and linked SQLite sidecars", () => {
  const home = labHome();
  const folder = join(home, ".startupbot-qualification");
  mkdirSync(folder, { mode: 0o700 });
  chmodSync(folder, 0o755);
  expect(() => openLabJournal(home)).toThrow();
  chmodSync(folder, 0o700);
  openLabJournal(home).close();
  const path = join(folder, "zalo-official", "receipts.sqlite-journal");
  const elsewhere = join(home, "outside");
  writeFileSync(elsewhere, "fixture-private");
  symlinkSync(elsewhere, path);
  expect(() => openLabJournal(home)).toThrow();
  expect(readFileSync(elsewhere, "utf8")).toBe("fixture-private");
});
