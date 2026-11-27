import { expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localFork, readRollout, searchRollouts } from "./local-codex-history.ts";

it("indexes only local metadata and forks the selected StartupBot cursor under the matching account and CWD", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omb-history-")));
  try {
    const sessions = join(root, "sessions");
    const year = join(sessions, "2026");
    mkdirSync(year, { recursive: true });
    const id = "12345678-1234-1234-1234-123456789abc";
    const file = join(year, "rollout-fixture.jsonl");
    const cwd = process.cwd();
    writeFileSync(file, JSON.stringify({ type: "session_meta", payload: { thread_id: id, cwd, git: { branch: "ledger" } } }) + '\n{"text":"private prompt"}\n');
    writeFileSync(join(year, "rollout-broken.jsonl"), "bad json");
    writeFileSync(join(root, "bots.json"), JSON.stringify([{ threadId: "old", tasks: [{ threadId: "current", resumeCursors: { localCodex: id } }] }]));
    expect(searchRollouts(sessions, "LEDGER")).toEqual({ results: [{ id, file, cwd, branch: "ledger" }], truncated: false });
    writeFileSync(join(year, "rollout-2000.jsonl"), JSON.stringify({ type: "session_meta", payload: { id, cwd, git: { branch: "old-copy" } } }));
    expect(searchRollouts(sessions).results.map(row => row.file)).toEqual([file]);
    expect(searchRollouts(sessions, "old-copy").results).toEqual([]);
    expect(searchRollouts(sessions, "private prompt").results).toEqual([]);
    expect(localFork(file, root, root, "current", "localCodex").id).toBe(id);
    expect(() => localFork(file, root, root, "current", "someoneElse")).toThrow(/do not own/);
    expect(() => localFork(file, root, root, "old", "localCodex")).toThrow(/do not own/);
    const other = join(root, "rollout-outside.jsonl");
    writeFileSync(other, "{}");
    expect(() => localFork(other, root, root)).toThrow(/current Codex account/);
    writeFileSync(file, JSON.stringify({ type: "session_meta", id, payload: { cwd: root } }));
    expect(() => localFork(file, root, root)).toThrow(/original working directory/);
    expect(readRollout(join(year, "rollout-broken.jsonl"))).toBe(null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
