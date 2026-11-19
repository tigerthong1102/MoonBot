import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { configureStartupBotIdentity, internalDeepLink, packagedSmokeHome, queueIncomingChatLink, startupBotDataDir, unavailableStartupBotCloud } from "./startupbot-identity.mjs";

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

test("only an explicit package fixture changes the server's home", () => {
  const home = path.resolve("temporary-fixture");
  assert.deepEqual(packagedSmokeHome({ OMB_SMOKE_HOME: home }), {});
  assert.deepEqual(packagedSmokeHome({ OMB_SMOKE_TEST: "1", OMB_SMOKE_HOME: home }), { HOME: home, USERPROFILE: home });
  assert.throws(() => packagedSmokeHome({ OMB_SMOKE_TEST: "1", OMB_SMOKE_HOME: "relative" }), /absolute/);
});

test("an explicit absolute Electron profile stays isolated from the default profile", () => {
  const profile = path.resolve("temporary-fixture", "electron-profile");
  const state = {};
  const app = {
    commandLine: { getSwitchValue: () => profile },
    setName: () => {}, setPath: (key, value) => { state[key] = value; },
    setAppLogsPath: value => { state.logs = value; },
    getPath: () => path.resolve("default-appdata"),
  };
  configureStartupBotIdentity(app);
  assert.equal(state.userData, profile);
  assert.equal(state.logs, path.join(profile, "logs"));
  app.commandLine.getSwitchValue = () => "relative-profile";
  assert.throws(() => configureStartupBotIdentity(app), /absolute/);
});

test("maps only StartupBot deep links to the existing protocol handlers", () => {
  assert.equal(internalDeepLink("startupbot://team/abc"), "openmausbot://team/abc");
  assert.equal(internalDeepLink("https://startupbot.ai"), "https://startupbot.ai");
  assert.equal(internalDeepLink("STARTUPBOT://team/abc"), "openmausbot://team/abc");
  for (const scheme of ["startupbot", "StartupBot", "STARTUPBOT"]) {
    assert.equal(internalDeepLink(`${scheme}://bot/AbC?code=FiXtUrE#ToKeN`), "openmausbot://bot/AbC?code=FiXtUrE#ToKeN");
  }
  assert.equal(internalDeepLink("startupbot.ai://bot/abc"), "startupbot.ai://bot/abc");
  assert.equal(internalDeepLink("openmausbot://bot/AbC"), "openmausbot://bot/AbC");
  assert.equal(internalDeepLink(null), null);
});

test("only parsed chat links are queued and delivered", () => {
  const events = [];
  const handlers = { parse: value => value === "valid" ? "parsed" : null, store: value => events.push(value), reveal: () => events.push("reveal"), deliver: () => events.push("deliver") };
  assert.equal(queueIncomingChatLink("invalid", handlers), false);
  assert.deepEqual(events, []);
  assert.equal(queueIncomingChatLink("valid", handlers), true);
  assert.deepEqual(events, ["parsed", "reveal", "deliver"]);
});

test("personal messaging opens only the operator-configured HTTPS origin", async () => {
  const { personalInboxOrigin } = await import("./startupbot-identity.mjs");
  assert.equal(personalInboxOrigin("https://inbox.example.test"), "https://inbox.example.test");
  for (const value of [undefined, "file:///tmp", "javascript:alert(1)", "https://x@example.test", "https://example.test/path"]) {
    assert.equal(personalInboxOrigin(value), null);
  }
});

test("the inbox supports installed desktop profiles and a missing configuration", async () => {
  const { configuredInboxOrigin } = await import("./startupbot-identity.mjs");
  const read = () => ({origin:"https://pilot.example.test"});
  assert.equal(configuredInboxOrigin(undefined,undefined,read),"https://pilot.example.test");
  assert.equal(configuredInboxOrigin(undefined,"https://build.example.test",read),"https://build.example.test");
  assert.equal(configuredInboxOrigin(undefined,undefined,()=>{throw Error("missing")}),null);
});
