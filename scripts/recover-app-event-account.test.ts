import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";

const command = fileURLToPath(new URL("./recover-app-event-account.mjs", import.meta.url));
const filename = "app-triggers.json";
const legacy = { version: 1, pollerId: "fixture-poller", cursor: 8, triggers: [], attempts: [], heldEvents: ["fixture-event"] };
const scope = createHash("sha256").update(JSON.stringify(["https://original.invalid", "fixture-installation"])).digest("hex");
const scoped = { ...legacy, cursorScope: scope };
const sidecar = JSON.stringify({ version: 3, events: [{ id: "fixture-event", reason: "unknown" }] });
let root: string, source: string, backup: string, out: string;
const run = (destination = out) => spawnSync(process.execPath, [command, "--profile", source, "--trusted-backup", backup, "--output", destination], { encoding: "utf8" });
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "startupbot-recovery-"));
  source = path.join(root, "profile"); backup = path.join(root, "backup"); out = path.join(root, "recovered");
  for (const folder of [source, backup]) {
    mkdirSync(folder);
    writeFileSync(path.join(folder, filename), JSON.stringify(folder === source ? legacy : scoped));
    writeFileSync(path.join(folder, filename + ".held"), sidecar);
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("copies both matched files, preserves every source byte and refuses to overwrite prior output", () => {
  expect(run().status).toBe(0);
  expect(readFileSync(path.join(out, filename), "utf8")).toBe(JSON.stringify(scoped));
  expect(readFileSync(path.join(out, filename + ".held"), "utf8")).toBe(sidecar);
  expect(run().status).toBe(1);
  expect(readFileSync(path.join(source, filename), "utf8")).toBe(JSON.stringify(legacy));
  expect(readFileSync(path.join(backup, filename), "utf8")).toBe(JSON.stringify(scoped));
});
it.each(["cursor", "poller", "ledger", "sidecar", "unverified", "inside-source"])("rejects a mismatched or unsafe recovery (%s)", issue => {
  if (issue === "cursor") writeFileSync(path.join(backup, filename), JSON.stringify({ ...scoped, cursor: 9 }));
  if (issue === "poller") writeFileSync(path.join(backup, filename), JSON.stringify({ ...scoped, pollerId: "other-poller" }));
  if (issue === "ledger") writeFileSync(path.join(backup, filename), JSON.stringify({ ...scoped, attempts: ["fixture-sensitive-text"] }));
  if (issue === "sidecar") writeFileSync(path.join(backup, filename + ".held"), "fixture-sensitive-text");
  if (issue === "unverified") writeFileSync(path.join(backup, filename), JSON.stringify(legacy));
  const destination = issue === "inside-source" ? path.join(source, "output") : out;
  const result = run(destination);
  expect(result.status).toBe(1);
  expect(result.stderr).not.toContain("fixture-sensitive-text");
  expect(existsSync(destination)).toBe(false);
});
