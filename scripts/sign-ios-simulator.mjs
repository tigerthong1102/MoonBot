import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const app = path.resolve(process.argv[2]);
const evidence = path.resolve("mobile-artifacts/ios");
mkdirSync(evidence, { recursive: true });
const readPlist = file => JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" }));
const bundles = readdirSync(path.join(app, "PlugIns")).filter(file => file.endsWith(".appex")).map(file => path.join(app, "PlugIns", file));
bundles.push(app);
for (const bundle of bundles) {
  const info = readPlist(path.join(bundle, "Info.plist"));
  assert(info.CFBundleSupportedPlatforms.includes("iPhoneSimulator"), "Only simulator apps may receive internal ad-hoc signatures");
  assert(info.CFBundleIdentifier.startsWith("ai.startupbot.ios"));
  const shared = info.CFBundleIdentifier === "ai.startupbot.ios" || info.CFBundleIdentifier.endsWith(".share");
  const entitlements = { "application-identifier": info.CFBundleIdentifier, "get-task-allow": true,
    ...(shared ? { "keychain-access-groups": [info.CFBundleIdentifier, "group.ai.startupbot.shared"], "com.apple.security.application-groups": ["group.ai.startupbot.shared"] } : {}) };
  if (shared) execFileSync("plutil", ["-replace", "OpenMausKeychainAccessGroup", "-string", "group.ai.startupbot.shared", path.join(bundle, "Info.plist")]);
  const file = path.join(evidence, `${info.CFBundleIdentifier}.entitlements.plist`);
  writeFileSync(file, JSON.stringify(entitlements));
  execFileSync("plutil", ["-convert", "xml1", file]);
  execFileSync("codesign", ["--force", "--sign", "-", "--generate-entitlement-der", "--entitlements", file, bundle], { stdio: "inherit" });
}
execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
console.log("Simulator-only ad-hoc signatures retain StartupBot Keychain and App Group entitlements");
