import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AppTriggerTestQuarantine } from "./app-trigger-test-quarantine.ts";

it("persists a deduplicated, payload-free record and fails closed on corruption", () => {
  const dir = mkdtempSync(join(tmpdir(), "test-quarantine-"));
  const file = join(dir, "quarantine.json");
  try {
    const input = { eventId: "fixture-secret-event", remoteId: "fixture-secret-remote", seq: 4 };
    const first = new AppTriggerTestQuarantine(file, () => 12);
    first.record(input);
    first.record(input);
    expect(first.count()).toBe(1);
    expect(readFileSync(file, "utf8")).not.toContain("fixture-secret");
    const reopened = new AppTriggerTestQuarantine(file);
    reopened.record(input);
    expect(reopened.count()).toBe(1);
    writeFileSync(file, "broken");
    const corrupt = new AppTriggerTestQuarantine(file);
    expect(() => corrupt.record(input)).toThrow("cannot be read");
    expect(readFileSync(file, "utf8")).toBe("broken");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


it("does not discard existing records when its bounded store is full", () => {
  const dir = mkdtempSync(join(tmpdir(), "test-quarantine-full-"));
  const file = join(dir, "quarantine.json");
  try {
    const entries = Array.from({ length: 4096 }, (_, index) => ({ key: index.toString(16).padStart(64, "0"), remote: "a".repeat(64), seq: index, at: 1 }));
    const original = JSON.stringify({ version: 1, entries });
    writeFileSync(file, original);
    const quarantine = new AppTriggerTestQuarantine(file);
    expect(quarantine.count()).toBe(4096);
    expect(() => quarantine.record({ eventId: "fixture-event", remoteId: "fixture-remote", seq: 4097 })).toThrow();
    expect(readFileSync(file, "utf8")).toBe(original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
