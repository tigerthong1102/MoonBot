import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createBotWorkspaceIdHost } from "./bot-workspace-id-host.ts";
import { WorkspaceBackupMaintenance } from "./workspace-backup-maintenance.ts";

it("fails closed when saved bot anchors are present or unreadable", () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-workspace-host-fixture-"));
  try {
    const file = join(directory, "bots.json"), maintenance = new WorkspaceBackupMaintenance();
    const ids = createBotWorkspaceIdHost({ directory, maintenance, bots: () => [] });
    expect(() => ids.loadOrCreate()).toThrow(/restore/);
    writeFileSync(file, "broken fixture");
    expect(() => ids.loadOrCreate()).toThrow(/restore/);
    writeFileSync(file, JSON.stringify([{ id: "fixture", groupUsername: null }]));
    expect(() => ids.loadOrCreate()).toThrow(/restore/);
    writeFileSync(file, JSON.stringify([{ id: "fixture" }]));
    const id = ids.loadOrCreate();
    expect(JSON.parse(readFileSync(join(directory, "bot-workspace-identity.json"), "utf8")).id).toBe(id);
    expect(ids.loadOrCreate()).toBe(id);
    writeFileSync(file, "broken fixture");
    expect(() => ids.loadOrCreate()).toThrow(/restore/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it("refuses identity allocation while a workspace restore holds maintenance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "startupbot-workspace-host-fixture-"));
  try {
    writeFileSync(join(directory, "bots.json"), JSON.stringify([{ id: "fixture" }]));
    const maintenance = new WorkspaceBackupMaintenance();
    const ids = createBotWorkspaceIdHost({ directory, maintenance, bots: () => [] });
    let finish!: () => void, entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const restoring = maintenance.run(async () => { entered(); await gate; }, { idle: () => true, pause: () => {}, flush: async () => {}, resume: () => {} });
    await ready;
    expect(() => ids.loadOrCreate()).toThrow(/backup|restore/i);
    finish(); await restoring;
    expect(ids.loadOrCreate()).toMatch(/^[0-9a-f-]{36}$/i);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
