import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { expect, it } from "vitest";
import { brokerClient } from "./app-trigger-broker.ts";
import { AppTriggerManager, type AppTriggerManagerOptions } from "./app-triggers.ts";

it("holds the cursor for malformed broker batches without logging their payload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "strict-broker-fixture-"));
  const observed: string[] = [];
  const afters: string[] = [];
  const pollers: string[] = [];
  const event = (seq: number) => ({ seq, id: `fixture-${seq}`, kind: "message", triggerId: "fixture-remote", receivedAt: 1, event: { data: {} }, newField: true });
  let body: unknown = { events: [], cursor: 0 };
  let invalidJson = false;
  const server = createServer((request, response) => {
    afters.push(new URL(request.url!, "http://localhost").searchParams.get("after")!);
    pollers.push(String(request.headers["x-omb-poller"]));
    response.writeHead(200, { "content-type": "application/json" }); response.end(invalidJson ? '{"secret":"fixture-private-marker' : JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture address");
  const broker = brokerClient(() => ({ url: `http://127.0.0.1:${address.port}`, token: "fixture" }), fetch, { strictEvents: true });
  const file = join(dir, "triggers.json");
  writeFileSync(file, JSON.stringify({ version: 1, pollerId: "fixture-poller", cursor: 0, triggers: [], attempts: [], deleted: [] }));
  const options: AppTriggerManagerOptions = { file, broker, service: () => ({ available: true }), connectedApps: async () => ({}), botState: () => "ready", log: text => observed.push(text), runs: { enqueue: () => ({ id: "fixture" }), merge: () => null, receipt: () => null, pending: () => 0, cancelQueued: () => {} } };
  let manager = new AppTriggerManager(options);
  try {
    for (const malformed of [
      { events: [event(1), { ...event(2), kind: "new-kind", event: { data: { marker: "fixture-private-marker" } } }, event(3)], cursor: 3 },
      { events: [{ ...event(1), seq: undefined }], cursor: 1 },
      { events: [event(2), event(1)], cursor: 1 },
      { events: [], cursor: 7 },
      { events: [{ ...event(1), id: "" }], cursor: 1 },
      { events: [{ ...event(1), receivedAt: 1e300 }], cursor: 1 },
      { events: [{ ...event(1), triggerId: null }], cursor: 1 },
      { events: [{ ...event(1), kind: "account_expired", triggerId: null }], cursor: 1 },
    ]) {
      body = malformed;
      await expect(manager.pollOnce(undefined, 0)).rejects.toThrow("invalid event batch");
    }
    manager = new AppTriggerManager(options);
    body = { events: [event(1), { ...event(2), kind: "unsupported" }, event(3)], cursor: 3 };
    await expect(manager.pollOnce(undefined, 0)).rejects.toThrow("invalid event batch");
    invalidJson = true;
    const failure = await manager.pollOnce(undefined, 0).catch(error => error);
    expect(failure.message).toBe("The connected-apps service returned an invalid event batch");
    expect(failure.message).not.toContain("fixture-private-marker");
    invalidJson = false;
    const status = { ...event(3), kind: "account_expired", triggerId: null, event: { data: { connected_account_id: "fixture-account" } } };
    body = { events: [event(1), event(2), status], cursor: 3 };
    expect(await manager.pollOnce(undefined, 0)).toBe(3);
    expect(afters).toEqual(["0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"]);
    expect(new Set(pollers)).toEqual(new Set(["fixture-poller"]));
    expect(JSON.stringify(observed)).not.toContain("fixture-private-marker");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); rmSync(dir, { recursive: true, force: true }); }
});

it("does not retry or disclose payload when a test-event receipt is uncertain", async () => {
  for (const failure of [
    () => new Response("{bad fixture-secret", { status: 201 }),
    () => Response.json({ queued: true, id: "invalid", seq: 1 }, { status: 201 }),
    () => Response.json({ queued: true, id: "test_12345678-1234-4234-8234-123456789abc", seq: Number.MAX_SAFE_INTEGER + 1 }, { status: 201 }),
    () => Response.json({ error: "fixture-secret" }, { status: 429 }),
    () => Response.json({ error: "fixture-secret" }, { status: 503 }),
    () => { throw new Error("fixture-secret response lost after enqueue"); },
  ]) {
    let posts = 0;
    const fakeFetch = (async () => { posts += 1; return failure(); }) as typeof fetch;
    const client = brokerClient(() => ({ url: "http://fixture.invalid", token: "fixture" }), fakeFetch, { strictEvents: true });
    const error = await client.testEventReceipt!("fixture-remote", { marker: "fixture-secret" }).catch(value => value);
    expect(error.message).toBe("The connected-apps service did not confirm the test event");
    expect(JSON.stringify(error)).not.toContain("fixture-secret");
    expect(posts).toBe(1);
  }
});
