import assert from "node:assert/strict";
import { cpSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { smokeDesktopRestart } from "./smoke-desktop-restart.mjs";

const { values } = parseArgs({ options: { fixture: { type: "string" }, app: { type: "string" }, output: { type: "string" } } });
assert(values.fixture && values.app && values.output, "--fixture, --app and --output are required");
const source = realpathSync(path.resolve(values.fixture)), output = path.resolve(values.output);
const within = (root, child) => { const rel = path.relative(root, child); return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel)); };
let ancestor = output;
while (true) { try { ancestor = realpathSync(ancestor); break; } catch { const parent = path.dirname(ancestor); assert(parent !== ancestor, "No output ancestor"); ancestor = parent; } }
assert(!within(source, ancestor), "Output cannot be inside the fixture");
function assertNoLinks(dir) {
  for (const entry of readdirSync(dir)) {
    const item = path.join(dir, entry), stat = lstatSync(item);
    assert(!stat.isSymbolicLink(), `Fixture contains a symbolic link: ${item}`);
    if (stat.isDirectory()) assertNoLinks(item);
  }
}
assertNoLinks(source);
const fixture = mkdtempSync(path.join(tmpdir(), "startupbot-upgrade-"));
const lifecycle = { started: false, stopped: false };
try {
  cpSync(source, fixture, { recursive: true });
  const expected = JSON.parse(readFileSync(path.join(fixture, "expected.json"), "utf8"));
  const home = path.join(fixture, "home"), data = path.join(home, ".startupbot"), profile = path.join(fixture, "electron-profile");
  const configPath = path.join(data, "config.json"), config = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(Object.keys(config.instances), ["claude"], "Only the synthetic provider is allowed");
  assert.equal(config.instances.claude.driver, "claudeAgent");
  const providerEnv = config.instances.claude.environment;
  const oldFixture = path.dirname(providerEnv.FAKE_CLAUDE_ROOM_PLAN);
  assert(path.isAbsolute(oldFixture) && oldFixture !== path.parse(oldFixture).root && oldFixture !== fixture, "Invalid original fixture path");
  const botsPath = path.join(data, "bots.json"), bots = JSON.parse(readFileSync(botsPath, "utf8"));
  for (const bot of bots) for (const record of [bot, ...(bot.tasks ?? [])]) {
    if (!record.cwd) continue;
    assert(path.isAbsolute(record.cwd) && within(oldFixture, record.cwd), "Workspace is outside the synthetic fixture");
    record.cwd = path.join(fixture, path.relative(oldFixture, record.cwd));
    assert(within(fixture, record.cwd), "Workspace escaped the fixture copy");
  }
  writeFileSync(botsPath, JSON.stringify(bots));
  config.instances.claude.config = { cli: fileURLToPath(new URL("../server/testing/fake-claude-cli.ts", import.meta.url)) };
  config.instances.claude.environment = { FAKE_CLAUDE_ROOM_PLAN: path.join(fixture, "chat-plan.json"), FAKE_CLAUDE_TEXT_ROUTES: path.join(fixture, "work-topic.json"), FAKE_CLAUDE_PROMPTS: path.join(fixture, "provider-prompts.jsonl") };
  writeFileSync(configPath, JSON.stringify(config));
  const followupText = "Synthetic followup after upgrade 4102", followupReply = "Synthetic followup result 4102";
  writeFileSync(config.instances.claude.environment.FAKE_CLAUDE_ROOM_PLAN, JSON.stringify({ [expected.botId]: { script: [{ key: "followup", match: [followupText], reply: followupReply }] } }));
  const env = { PATH: process.env.PATH, HOME: process.platform === "darwin" ? process.env.HOME : home, USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"), XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"),
    OMB_COMPANION_DIR: path.join(fixture, "phones"), OMB_COMPANION_BONJOUR: "0", OMB_DATA_DIR: data, OMB_SMOKE_HOME: home, OMB_SMOKE_TEST: "1", OMB_SMOKE_KEEP_OPEN: "1", OMB_SMOKE_CUA: "0",
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot } : {}), ...(process.env.TEMP ? { TEMP: process.env.TEMP, TMP: process.env.TEMP } : {}) };
  mkdirSync(output, { recursive: true });
  const evidence = mkdtempSync(path.join(realpathSync(output), "run-"));
  const firstEvidence = path.join(evidence, "first"), secondEvidence = path.join(evidence, "second");
  mkdirSync(firstEvidence); mkdirSync(secondEvidence);
  const executable = process.platform === "darwin" ? path.join(path.resolve(values.app), "Contents", "MacOS", "StartupBot") : path.resolve(values.app);
  const options = { executable, profile, fixture, env, helper: { id: expected.botId }, workBot: { id: expected.botId, threadId: expected.threadId }, workMessage: expected.oldText,
    workRequestId: expected.messageId, replyText: expected.oldReply, prompts: config.instances.claude.environment.FAKE_CLAUDE_PROMPTS, workspaceFile: path.join(home, "synthetic-old-file.txt"),
    fileContents: "baseline fixture file", botIds: bots.map(bot => bot.id), evidence: firstEvidence, lifecycle, routineId: expected.routineId, expectedSkin: expected.expectedSkin, expectedWorkspace: expected.expectedWorkspace === "home" ? home : undefined, stablePort: expected.stablePort, usernameGroup: expected.usernameGroup };
  const first = await smokeDesktopRestart({ ...options, legacyOffer: expected.legacyOffer });
  const second = await smokeDesktopRestart({ ...options, evidence: secondEvidence, followupText, followupReply });
  const result = { status: "PASS", first, second, limits: `Synthetic profile; theme ${first.theme}; workspace ${first.workspace}; no due-time routine, companion, or live-provider test` };
  writeFileSync(path.join(evidence, "upgrade-profile.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, evidence }));
} finally {
  if (!lifecycle.started || lifecycle.stopped) rmSync(fixture, { recursive: true, force: true });
  else console.error(`Fixture retained: ${fixture}`);
}
