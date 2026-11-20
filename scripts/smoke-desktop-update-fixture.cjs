const assert = require("node:assert/strict");
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const root = process.env.STARTUPBOT_UPDATE_SMOKE_ROOT;
app.setPath("userData", path.join(root, "profile"));
app.setPath("sessionData", path.join(root, "profile"));
app.setPath("logs", path.join(root, "logs"));
app.dock?.hide();

async function run() {
  await app.whenReady();
  assert.equal(app.isPackaged, true);
  const workspace = readFileSync(path.join(app.getPath("userData"), "workspace.json"), "utf8");
  const result = { version: app.getVersion(), workspace };
  const mode = process.env.STARTUPBOT_UPDATE_SMOKE_MODE;
  if (mode !== "reopen") {
    const { configureDesktopUpdater } = await import("./updater-config.mjs");
    const { autoUpdater } = require("./electron-updater.cjs");
    const config = JSON.parse(readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8"));
    await configureDesktopUpdater(autoUpdater, {
      feed: { provider: config.provider, channel: config.channel, url: config.url },
      publisher: process.platform === "win32" ? config.publisherName[0] : null,
    });
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    if (process.platform === "win32") autoUpdater.installDirectory = path.dirname(process.execPath);
    let downloaded = false;
    autoUpdater.on("update-downloaded", () => { downloaded = true; });
    autoUpdater.on("error", () => {});
    const check = await autoUpdater.checkForUpdates();
    assert.equal(check.updateInfo.version, "1.0.1");
    if (mode === "upgrade") {
      await autoUpdater.downloadUpdate();
      assert.equal(downloaded, true);
    } else {
      await assert.rejects(autoUpdater.downloadUpdate(), (error) => {
        if (mode === "corrupt") assert.equal(error.code, "ERR_CHECKSUM_MISMATCH");
        else assert.match(error.toString(), /signature|powershell/i);
        result.rejected = true;
        return true;
      });
      assert.equal(downloaded, false);
    }
  }
  writeFileSync(path.join(root, "result.json"), JSON.stringify(result));
}
run().then(() => app.quit(), (error) => {
  console.error(error);
  app.exit(1);
});
