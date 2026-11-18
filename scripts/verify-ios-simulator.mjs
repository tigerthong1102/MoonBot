import assert from "node:assert/strict";
import { simulatedEntitlementsFromDump } from "./ios-simulator-entitlements.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const app = path.resolve(process.argv[2]);
const evidence = path.resolve("mobile-artifacts/ios");
mkdirSync(evidence, { recursive: true });
const readPlist = file => JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" }));
const bundles = readdirSync(path.join(app, "PlugIns")).filter(file => file.endsWith(".appex")).map(file => path.join(app, "PlugIns", file));
bundles.push(app);
for (const bundle of bundles) {
  const info = readPlist(path.join(bundle, "Info.plist"));
  assert(info.CFBundleSupportedPlatforms.includes("iPhoneSimulator"), "Only simulator builds may use this verification lane");
  assert(info.CFBundleIdentifier.startsWith("ai.startupbot.ios"));
  const host = execFileSync("codesign", ["-d", "--entitlements", ":-", bundle], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert(!/keychain-access-groups|com\.apple\.security\.application-groups/.test(host), "Simulator capabilities belong in Mach-O simulated entitlements, not host signing claims");
  const debug = path.join(bundle, `${info.CFBundleExecutable}.debug.dylib`);
  const binaries = [path.join(bundle, info.CFBundleExecutable), ...(existsSync(debug) ? [debug] : [])];
  for (const arch of ["arm64", "x86_64"]) {
    const sections = binaries.map(binary => {
      const dump = execFileSync("otool", ["-arch", arch, "-s", "__TEXT", "__entitlements", binary], { encoding: "utf8" });
      return simulatedEntitlementsFromDump(dump);
    });
    const xml = sections.find(section => section.includes("<plist")) ?? "";
    assert(xml.includes("<plist"), `${info.CFBundleIdentifier}/${arch} has no simulated entitlement section`);
    const entitlements = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", "-"], { input: xml, encoding: "utf8" }));
    if (info.CFBundleIdentifier === "ai.startupbot.ios" || info.CFBundleIdentifier.endsWith(".share")) {
      assert(entitlements["keychain-access-groups"].includes(info.OpenMausKeychainAccessGroup));
      assert(entitlements["com.apple.security.application-groups"].includes("group.ai.startupbot.shared"));
      assert(!info.OpenMausKeychainAccessGroup.includes("$("));
    }
    writeFileSync(path.join(evidence, `${info.CFBundleIdentifier}.${arch}.simulated-entitlements.plist`), xml);
  }
}
execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
console.log("PASS: Xcode host signatures and simulated Keychain/App Group capabilities");
