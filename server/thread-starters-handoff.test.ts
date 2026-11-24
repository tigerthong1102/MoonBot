import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ThreadStarters } from "./thread-starters.ts";

it("persists the private handoff owner before accepting it and rejects conflicting owners", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-owner-"));
  try {
    const file = join(dir, "starters.json");
    const owner = `p_${"a".repeat(22)}`;
    const other = `p_${"b".repeat(22)}`;
    const starters = new ThreadStarters(file);
    starters.setRequired("target-thread", owner);
    expect(new ThreadStarters(file).get("target-thread")).toBe(owner);
    expect(() => starters.setRequired("target-thread", other)).toThrow("another person");
    expect(new ThreadStarters(file).get("target-thread")).toBe(owner);
    const unavailable = new ThreadStarters(join(dir, "missing", "starters.json"));
    expect(() => unavailable.setRequired("target-thread", owner)).toThrow();
    expect(unavailable.get("target-thread")).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
