import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { configureStartupBotIdentity, internalDeepLink, startupBotDataDir, unavailableStartupBotCloud } from "./startupbot-identity.mjs";

test("desktop identity uses its own application and data directories", () => {
  const state = {};
  const app = { setName: (name) => { state.name = name; }, setPath: (key, value) => { state[key] = value; }, getPath: () => path.join("root", "appdata") };
  configureStartupBotIdentity(app);
  assert.equal(state.name, "StartupBot");
  assert.equal(state.userData, path.join("root", "appdata", "StartupBot"));
  assert.equal(startupBotDataDir("home", ""), path.join("home", ".startupbot"));
  assert.equal(startupBotDataDir("home", path.join("custom", "data")), path.join("custom", "data"));
});

test("the unconfigured cloud client cannot contact an upstream service", async () => {
  await assert.rejects(unavailableStartupBotCloud(), /StartupBot Cloud is not configured/);
});

test("maps only StartupBot deep links to the existing protocol handlers", () => {
  assert.equal(internalDeepLink("startupbot://team/abc"), "openmausbot://team/abc");
  assert.equal(internalDeepLink("https://startupbot.ai"), "https://startupbot.ai");
  assert.equal(internalDeepLink("STARTUPBOT://team/abc"), "STARTUPBOT://team/abc");
});
