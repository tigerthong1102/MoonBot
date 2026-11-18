import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const original = readFileSync(path.join(root, "branding/startupbot-original.png"));
const opaque = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024"><rect width="1024" height="1024" fill="white"/><image xlink:href="data:image/png;base64,${original.toString("base64")}" width="1024" height="1024"/></svg>`;
const icon = new Resvg(opaque).render();
writeFileSync(path.join(root, "ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png"), icon.asPng());
const folder = path.join(root, "ios/Shared/Assets.xcassets/StartupBotLogo.imageset");
mkdirSync(folder, { recursive: true });
writeFileSync(path.join(root, "ios/Shared/Assets.xcassets/Contents.json"), JSON.stringify({ info: { author: "xcode", version: 1 } }, null, 2) + "\n");
writeFileSync(path.join(folder, "Contents.json"), JSON.stringify({ images: [{ filename: "startupbot-logo.png", idiom: "universal" }], info: { author: "xcode", version: 1 } }, null, 2) + "\n");
const branded = readFileSync(path.join(root, "public/startupbot-icon-512.png"));
writeFileSync(path.join(folder, "startupbot-logo.png"), branded);
const drawable = path.join(root, "android/app/src/main/res/drawable-nodpi");
mkdirSync(drawable, { recursive: true });
writeFileSync(path.join(drawable, "startupbot_logo.png"), branded);
for (const platform of ["android/app/src/main/assets/licenses", "ios/App/Licenses"]) {
  const dest = path.join(root, platform);
  mkdirSync(dest, { recursive: true });
  for (const file of ["LICENSE", "NOTICE"]) writeFileSync(path.join(dest, `OpenMausBot-${file}.txt`), readFileSync(path.join(root, platform.startsWith("android") ? "android" : "ios", file)));
}
console.log("Generated StartupBot native icons and bundled attribution");
