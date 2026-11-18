import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCloudFilesService } from "./cloud-sync.mjs";
import { openSyncState } from "./cloud-sync-state.mjs";
import { fakeCloud } from "./fixtures/cloud-sync-fake-cloud.mjs";

function fixture(t, { legacy = false, place = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "startupbot-output-root-"));
  const documentsDir = path.join(root, "Documents");
  const oldRoot = path.join(documentsDir, "MausBot");
  const oldBot = path.join(oldRoot, "Owl");
  const oldPlace = path.join(oldBot, "Report");
  mkdirSync(oldPlace, { recursive: true });
  writeFileSync(path.join(oldPlace, "original.txt"), "preserved");
  const stateFile = path.join(root, "profile", "state.db");
  const state = openSyncState(stateFile);
  if (legacy) {
    state.setMeta("botdir:owl", oldBot);
    if (place) state.setPlace("bot-owl-report", oldPlace);
  }
  state.close();
  const cloud = fakeCloud();
  const origin = { value: "https://cloud.example.test" };
  writeFileSync(path.join(root, "profile", "settings.json"), JSON.stringify({
    version: 2, computerId: "fixture", origin: origin.value, shared: [], outputs: { enabled: true, since: 100 },
  }));
  cloud.setBots({ bots: [{ id: "owl", name: "Owl", tasks: [{ threadId: "report", title: "Report" }, { threadId: "new", title: "New" }] }], groups: [] });
  cloud.addFolder({ id: "bot-owl-report", kind: "bot", botId: "owl", threadId: "report", newestMs: 200 });
  cloud.addFolder({ id: "bot-owl-new", kind: "bot", botId: "owl", threadId: "new", newestMs: 200 });
  cloud.put("bot-owl-report", "report.md", "version one");
  cloud.put("bot-owl-new", "new.md", "new output");
  const services = [];
  const trashed = [];
  const open = () => {
    const service = createCloudFilesService({ settingsFile: path.join(root, "profile", "settings.json"), stateFile,
      documentsDir, homeDir: root, localDataDir: path.join(root, ".startupbot"), now: () => Date.now() + 60_000,
      cloudOrigin: () => origin.value, createClient: () => cloud.client, watch: () => () => {},
      freeBytes: () => 100 * 1024 ** 3, markDownloaded: async () => {}, trashItem: async file => {
        const backup = path.join(root, `trash-${trashed.length}`);
        renameSync(file, backup); trashed.push(backup);
      },
    });
    services.push(service);
    return service;
  };
  t.after(() => { for (const service of services) service.close(); rmSync(root, { recursive: true, force: true }); });
  return { open, cloud, documentsDir, oldRoot, oldPlace, stateFile, origin, trashed };
}

for (const place of [false, true]) test(`keeps legacy output ownership, including metadata-only state (place=${place})`, async t => {
  const f = fixture(t, { legacy: true, place });
  let service = f.open();
  assert.equal(service.state().outputs.dir, f.oldRoot);
  assert.equal(service.localFolder({ outputs: true }), f.oldRoot);
  await service.pass();
  f.cloud.put("bot-owl-report", "report.md", "version two");
  await service.pass();
  assert.equal(service.state().outputs.problem, null);
  const saved = openSyncState(f.stateFile);
  const reportPlace = saved.place("bot-owl-report"); saved.close();
  assert(reportPlace.startsWith(f.oldRoot + path.sep));
  if (place) assert.equal(reportPlace, f.oldPlace);
  assert.equal(readFileSync(path.join(reportPlace, "report.md"), "utf8"), "version two");
  assert.equal(readFileSync(path.join(f.oldPlace, "original.txt"), "utf8"), "preserved");
  assert.equal(readFileSync(f.trashed[0], "utf8"), "version one");
  assert.equal(readFileSync(path.join(f.oldRoot, "Owl", "New", "new.md"), "utf8"), "new output");
  assert.equal(existsSync(path.join(f.documentsDir, "StartupBot")), false);
  await service.setOutputs(false);
  service.close();
  const state = openSyncState(f.stateFile); state.reset(); state.close();
  service = f.open();
  assert.equal(service.state().outputs.dir, f.oldRoot);
  assert.equal(service.state().outputs.enabled, false);
  assert.equal(service.localFolder({ outputs: true }), f.oldRoot);
});

test("a fresh profile uses StartupBot and does not adopt another app's existing MausBot folder", async t => {
  const f = fixture(t);
  const service = f.open();
  const ownRoot = path.join(f.documentsDir, "StartupBot");
  assert.equal(service.localFolder({ outputs: true }), ownRoot);
  await service.pass();
  assert.equal(readFileSync(path.join(ownRoot, "Owl", "Report", "report.md"), "utf8"), "version one");
  assert.equal(readFileSync(path.join(f.oldPlace, "original.txt"), "utf8"), "preserved");
  assert.equal(existsSync(path.join(f.oldPlace, "report.md")), false);
});
