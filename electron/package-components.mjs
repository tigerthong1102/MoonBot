import { statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const shared = { ui: "ui/index.html", server: "server/index.js", companion: "companion/index.js" };
const desktop = {
  darwin: { computer: "cua-driver", speech: "StartupBot Speech.app/Contents/MacOS/speech-helper", tunnel: "cloudflared/cloudflared", browser: "browser-engine/agent-browser" },
  win32: { computer: "cua-driver.exe", backgroundComputer: "cua-driver-background.exe", tunnel: "cloudflared/cloudflared.exe", browser: "browser-engine/agent-browser.exe" },
  linux: { computer: "cua-linux-x64/cua-driver", tunnel: "cloudflared/cloudflared", browser: "browser-engine/agent-browser" },
};

export function packageComponents(root, platform) {
  if (!Object.hasOwn(desktop, platform)) throw new Error("Unsupported desktop platform");
  let browserVersion;
  try {
    const manifest = JSON.parse(readFileSync(join(root, "browser-engine/manifest.json"), "utf8"));
    if (manifest.target?.startsWith(platform + "-") && /^\d+\.\d+\.\d+$/.test(manifest.engine?.version))
      browserVersion = manifest.engine.version;
  } catch {}
  return Object.entries({ ...shared, ...desktop[platform] }).map(([component, relative]) => {
    try {
      const stat = statSync(join(root, relative));
      const executable = !Object.hasOwn(shared, component) && platform !== "win32";
      const status = !stat.isFile() || !stat.size ? "invalid" : executable && !(stat.mode & 0o111) ? "not-executable" : "present";
      return { component, status, ...(component === "browser" && status === "present" && browserVersion ? { version: browserVersion } : {}) };
    } catch (error) { return { component, status: error.code === "ENOENT" ? "missing" : "unreadable" }; }
  });
}
