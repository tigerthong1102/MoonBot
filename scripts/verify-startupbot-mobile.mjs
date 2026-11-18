import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
const text = file => readFileSync(file, "utf8");
assert(text("android/app/build.gradle.kts").includes('applicationId = "ai.startupbot.android"'));
assert(text("ios/project.yml").includes('PRODUCT_BUNDLE_IDENTIFIER: ai.startupbot.ios'));
assert(text("ios/project.yml").includes('name: StartupBot'));
assert(text("ios/AppShared/OpenMausSharedConfiguration.swift").includes('legacyAppBundleIdentifier = "ai.startupbot.ios"'));
assert(text("ios/project.yml").includes('group.ai.startupbot.shared'));
assert(text("scripts/smoke-ios-internal.sh").includes("--startupbot-internal-security-smoke"));
assert(text("scripts/sign-ios-simulator.mjs").includes('iPhoneSimulator'));
assert(!text("ios/project.yml").includes('com.openmausbot'));
assert(text("ios/App/MausAvatar.swift").includes('Image("StartupBotLogo")'));
assert(text("android/app/src/main/kotlin/com/openmausbot/companion/ui/MausAvatar.kt").includes('R.drawable.startupbot_logo'));
assert(text("ios/Sources/CompanionCore/PhoneSecret.swift").includes('"OpenMausBot phone credential v1"'));
assert(text("packages/phone-protocol/src/phone-secret-envelope.ts").includes('"OpenMausBot phone credential v1"'));
const approved = createHash("sha256").update(readFileSync("public/startupbot-icon-512.png")).digest("hex");
for (const file of ["android/app/src/main/res/drawable-nodpi/startupbot_logo.png", "ios/Shared/Assets.xcassets/StartupBotLogo.imageset/startupbot-logo.png"]) {
  assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), approved);
}
const icon = readFileSync("ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png");
assert.equal(icon.readUInt32BE(16), 1024); assert.equal(icon.readUInt32BE(20), 1024);
for (const platform of ["android", "ios"]) {
  assert(text(`${platform}/LICENSE`).includes("Apache License"));
  assert(text(`${platform}/NOTICE`).includes("Milind"));
}
function checkFiles(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (["build", ".build", ".gradle", ".swiftpm"].includes(entry.name)) continue;
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory()) checkFiles(file);
    else assert(!/\.(?:jks|keystore|p12|mobileprovision)$/.test(file), `Signing secret must not be bundled: ${file}`);
  }
}
checkFiles("android"); checkFiles("ios");
console.log("PASS: native identity, owner-supplied artwork, attribution and HPKE compatibility");
