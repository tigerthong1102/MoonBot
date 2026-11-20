import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import source from "./desktop-update-source.cjs";
const exec = promisify(execFile);

export function desktopUpdatePolicy(app, platform = process.platform, arch = process.arch) {
  if (!app.isPackaged || !["darwin", "win32"].includes(platform) || !["arm64", "x64"].includes(arch)) return null;
  try {
    const { startupbotUpdate } = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8"));
    if (startupbotUpdate?.target !== `${platform}-${arch}`) return null;
    const publisher = startupbotUpdate.publisher;
    if (platform === "win32" && (typeof publisher !== "string" || !/(?:^|,\s*)CN=[^,]+/i.test(publisher))) return null;
    return { feed: source.updateFeed(arch), publisher: platform === "win32" ? publisher : null };
  } catch {
    return null;
  }
}

export async function configureDesktopUpdater(updater, policy) {
  const config = await updater.configOnDisk.value;
  if (config.provider !== "generic" || config.url !== policy.feed.url || config.channel !== policy.feed.channel) {
    throw new Error("Invalid StartupBot update source");
  }
  if (policy.publisher) {
    const names = [config.publisherName].flat();
    if (names.length !== 1 || names[0] !== policy.publisher) throw new Error("Invalid StartupBot publisher");
    updater.verifyUpdateCodeSignature = async (_names, file) => {
      const command = "$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1'); $s=Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:STARTUPBOT_VERIFY_FILE; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -cne $env:STARTUPBOT_VERIFY_SUBJECT) { exit 1 }";
      try {
        await exec(join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoProfile", "-NonInteractive", "-Command", command], {
            windowsHide: true, timeout: 30_000, env: { ...process.env, STARTUPBOT_VERIFY_FILE: file, STARTUPBOT_VERIFY_SUBJECT: policy.publisher },
          });
      } catch {
        throw Object.assign(new Error("StartupBot installer signature could not be verified"), { code: "ERR_UPDATER_INVALID_SIGNATURE" });
      }
      return null;
    };
  }
  updater.setFeedURL(policy.feed);
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  updater.disableWebInstaller = true;
  updater.disableDifferentialDownload = true;
}
