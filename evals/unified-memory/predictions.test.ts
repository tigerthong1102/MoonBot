import { describe, expect, it } from "vitest";
import { corpusSha256, readPredictions } from "./predictions.ts";

const bytes = Buffer.from('{"version":2,"cases":[]}');
const hash = corpusSha256(bytes);
const file = { corpusVersion: 2, corpusSha256: hash, predictions: [{ id: "a", result: "match" }] };

describe("prediction corpus binding", () => {
  it("accepts only the exact corpus bytes and version", () => {
    expect(readPredictions(file, 2, hash)).toEqual(file.predictions);
    expect(() => readPredictions(file, 3, hash)).toThrow(/mismatch/);
    expect(() => readPredictions(file, 2, corpusSha256(Buffer.from('{"version":2,"cases":[1]}')))).toThrow(/mismatch/);
    expect(() => readPredictions(file, 2, corpusSha256(Buffer.from('{ "version":2,"cases":[]}')))).toThrow(/mismatch/);
  });
  it("rejects legacy unbound files and malformed envelopes", () => {
    expect(() => readPredictions(file.predictions, 2, hash)).toThrow(/bound/);
    expect(() => readPredictions({ ...file, predictions: null }, 2, hash)).toThrow(/predictions array/);
    expect(() => readPredictions(null, 2, hash)).toThrow(/bound/);
  });
});

it("enforces the binding at the report CLI boundary", async () => {
  const { readFileSync, mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const corpusBytes = readFileSync(new URL("./context-cases.json", import.meta.url));
  const corpus = JSON.parse(corpusBytes.toString("utf8")) as { version: number; cases: Array<{ id: string }> };
  const dir = mkdtempSync(join(tmpdir(), "twin-eval-"));
  const path = join(dir, "predictions.json");
  const report = fileURLToPath(new URL("./report.ts", import.meta.url));
  const invoke = () => spawnSync(process.execPath, ["--experimental-strip-types", report, "--context", path], { encoding: "utf8" });
  try {
    const bound = { corpusVersion: corpus.version, corpusSha256: corpusSha256(corpusBytes), predictions: [{ id: corpus.cases[0]!.id, result: "match" }] };
    writeFileSync(path, JSON.stringify(bound));
    const accepted = invoke();
    expect(accepted.status).toBe(0);
    expect(JSON.parse(accepted.stdout).status).toBe("INCOMPLETE");
    writeFileSync(path, JSON.stringify({ ...bound, corpusSha256: "0".repeat(64) }));
    const rejected = invoke();
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("mismatch");
    writeFileSync(path, JSON.stringify(bound.predictions));
    expect(invoke().status).not.toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
