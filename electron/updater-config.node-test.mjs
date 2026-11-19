import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { desktopUpdatePolicy, configureDesktopUpdater } from "./updater-config.mjs";

test("only the signed package profile for the running platform and architecture selects a fork feed", async t => {
  const root = await mkdtemp(join(tmpdir(), "startupbot-feed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = { isPackaged: true, getAppPath: () => root };
  const save = meta => writeFile(join(root, "package.json"), JSON.stringify({ startupbotUpdate: meta }));
  await save(undefined);
  assert.equal(desktopUpdatePolicy(app, "darwin", "arm64"), null);
  await save({ target: "win32-x64" });
  assert.equal(desktopUpdatePolicy(app, "win32", "x64"), null);
  await save({ target: "win32-x64", publisher: "CN=Example, O=Example" });
  const policy = desktopUpdatePolicy(app, "win32", "x64");
  assert.equal(policy.feed.url, "https://github.com/tigerthong1102/MoonBot/releases/latest/download");
  assert.equal(policy.feed.channel, "stable-x64");
  assert.equal(desktopUpdatePolicy(app, "win32", "arm64"), null);
  assert.equal(desktopUpdatePolicy(app, "linux", "x64"), null);
  assert.equal(desktopUpdatePolicy({ ...app, isPackaged: false }, "win32", "x64"), null);
  await save({ target: "darwin-arm64" });
  assert.equal(desktopUpdatePolicy(app, "darwin", "arm64").feed.channel, "stable-arm64");
});

test("invalid source, channel or Windows signer prevents contacting a feed", async () => {
  const feed = { provider: "generic", url: "https://github.com/tigerthong1102/MoonBot/releases/latest/download", channel: "stable-x64" };
  const publisher = "CN=Example, O=Example";
  for (const patch of [{ url: "https://example.org" }, { channel: "stable-arm64" }, { provider: "github" },
    { publisherName: undefined }, { publisherName: [] }, { publisherName: [publisher, "CN=Other"] }, { publisherName: "CN=Other" }]) {
    const updater = { configOnDisk: { value: Promise.resolve({ ...feed, publisherName: publisher, ...patch }) } };
    await assert.rejects(configureDesktopUpdater(updater, { feed, publisher }), /Invalid StartupBot/);
  }
  const updater = { configOnDisk: { value: Promise.resolve({ ...feed, publisherName: [publisher] }) }, setFeedURL: actual => assert.deepEqual(actual, feed) };
  await configureDesktopUpdater(updater, { feed, publisher });
  assert.equal(typeof updater.verifyUpdateCodeSignature, "function");
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.disableWebInstaller, true);
});
