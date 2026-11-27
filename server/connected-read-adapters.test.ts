import { describe, expect, it } from "vitest";
import { READ_ADAPTERS, readAdapterFor, type ReadApp } from "./connected-read-adapters.ts";
import { createConnectedReads } from "./connected-reads.ts";

describe.each(Object.keys(READ_ADAPTERS) as ReadApp[])("%s background read adapter", app => {
  it("accepts only its versioned operations and rejects file transfer", () => {
    for (const slug of READ_ADAPTERS[app].operations) expect(readAdapterFor(slug)).toBe(app);
    expect(READ_ADAPTERS[app].files).toBe(false);
    expect(() => readAdapterFor(app.toUpperCase() + "_UPLOAD_FILE")).toThrow("does not grant");
  });
  it("propagates service rate limits and revoked access on a reused session", async () => {
    let status = 429;
    let calls = 0;
    const session = createConnectedReads({
      connected: async () => ({ [app]: true }),
      relay: async payload => {
        const op = (payload as { method?: string }).method === "tools/call";
        if (op) calls++;
        return { status: op ? status : 200, bytes: new Uint8Array() };
      },
    }).session();
    const read = () => app === "gmail" ? session.address() : app === "outlook" ? session.outlookMessage("demo") : session.events(0, 10000);
    await expect(read()).rejects.toMatchObject({ app, rateLimited: true, signedOut: false });
    status = 403;
    await expect(read()).rejects.toMatchObject({ app, rateLimited: false, signedOut: true });
    expect(calls).toBe(2);
  });
});
