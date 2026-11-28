import { describe, expect, it } from "vitest";
import { fakeRecall } from "./fake-recall.ts";
import type { MemoryCase } from "./score.ts";

const cases: MemoryCase[] = [
  { id: "same", split: "development", category: "fixture", saved: "What is the policy?", query: "What policy applies?", expected: "none" },
  { id: "numbers", split: "development", category: "fixture", saved: "What is policy 1?", query: "What is policy 2?", expected: "match" },
];

describe("isolated fake recall adapter", () => {
  it("runs the real recall candidate and verification path without reading expected labels", async () => {
    const result = await fakeRecall(cases, "same");
    expect(result.predictions).toEqual([{ id: "same", result: "match" }, { id: "numbers", result: "none" }]);
    expect(result.calls).toBe(2);
    const reversed = cases.map(item => ({ ...item, expected: item.expected === "match" ? "none" as const : "match" as const }));
    expect(await fakeRecall(reversed, "same")).toEqual(result);
  });
  it("preserves no-selection and provider failure outcomes", async () => {
    expect(await fakeRecall(cases, "none")).toEqual({ predictions: [{ id: "same", result: "none" }, { id: "numbers", result: "none" }], calls: 1 });
    expect(await fakeRecall(cases, "error")).toEqual({ predictions: [{ id: "same", result: "error" }, { id: "numbers", result: "none" }], calls: 1 });
  });
});

it("runs the CLI with a declared fake and labels the score provenance", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const runner = fileURLToPath(new URL("./fake-recall-run.ts", import.meta.url));
  const report = fileURLToPath(new URL("./report.ts", import.meta.url));
  const invalid = spawnSync(process.execPath, ["--experimental-strip-types", runner, "--context"], { encoding: "utf8" });
  expect(invalid.status).not.toBe(0);
  const run = spawnSync(process.execPath, ["--experimental-strip-types", runner, "--context", "--fake=none"], { encoding: "utf8" });
  expect(run.status).toBe(0);
  const result = JSON.parse(run.stdout);
  expect(result.metadata).toMatchObject({ kind: "deterministic-fake", model: "none", network: "not-sandboxed", cost: 0 });
  expect(result.predictions).toHaveLength(260);
  const dir = mkdtempSync(join(tmpdir(), "twin-fake-eval-"));
  try {
    const file = join(dir, "fake.json");
    writeFileSync(file, run.stdout);
    const scored = spawnSync(process.execPath, ["--experimental-strip-types", report, "--context", file], { encoding: "utf8" });
    expect(scored.status).toBe(0);
    expect(JSON.parse(scored.stdout)).toMatchObject({ provenance: "DECLARED_SYNTHETIC_FAKE_NOT_MODEL", status: "COMPLETE" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("does not use common network entry points or read a sentinel credential in the in-process fixture", async () => {
  const { vi } = await import("vitest");
  const net = await import("node:net");
  const dns = await import("node:dns");
  const socket = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => { throw new Error("network forbidden"); });
  const lookup = vi.spyOn(dns.default, "lookup").mockImplementation(() => { throw new Error("network forbidden"); });
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("network forbidden"); });
  const previous = process.env;
  let credentialReads = 0;
  process.env = new Proxy(previous, {
    get(target, property, receiver) {
      if (property === "OPENAI_API_KEY") { credentialReads += 1; return "synthetic-fixture-key"; }
      return Reflect.get(target, property, receiver);
    },
  });
  try {
    expect((await fakeRecall(cases, "same")).predictions[0]?.result).toBe("match");
    expect(credentialReads).toBe(0);
    expect(socket).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    process.env = previous;
    socket.mockRestore();
    lookup.mockRestore();
    fetch.mockRestore();
  }
});
