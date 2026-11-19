import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import builder from "electron-builder";

const require = createRequire(import.meta.url);
const runFile = promisify(execFile);
const mac = process.platform === "darwin";
assert.ok(mac || process.platform === "win32", "Run on macOS or Windows");
const signing = process.env.RUNNER_ENVIRONMENT === "github-hosted" && process.env.STARTUPBOT_SMOKE_CERT;
const root = await mkdtemp(join(tmpdir(), "startupbot-update-smoke-"));
const project = join(root, "project");
const product = "StartupBot Update Fixture";
const archive = mac ? "StartupBot-fixture.zip" : "StartupBot-fixture.exe";
const workspace = JSON.stringify({ savedThread: randomUUID() });
const corrupt = Buffer.from("corrupted installer");
const originalSha = createHash("sha512").update("published installer").digest("base64");
const publisher = "CN=StartupBot Update Fixture";
const conf = join(project, "fixture.yml");
const base = dirname(fileURLToPath(import.meta.url));
const hits = [];
let asset = { size: corrupt.length, sha512: originalSha };
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  hits.push(path);
  if (path === "/fixture" + (mac ? "-mac" : "") + ".yml") {
    response.end(JSON.stringify({ version: "1.0.1", files: [{ url: archive, size: asset.size, sha512: asset.sha512 }], releaseDate: "2025-01-01T00:00:00Z" }));
  } else if (path === "/" + archive) {
    response.writeHead(200, { "content-length": asset.size });
    if (asset.file) createReadStream(asset.file).pipe(response);
    else response.end(corrupt);
  } else {
    response.writeHead(404).end();
  }
});

async function signFile(file) {
  if (mac) {
    await runFile("codesign", ["--force", "--sign", signing, "--keychain", process.env.STARTUPBOT_SMOKE_KEYCHAIN,
      "--preserve-metadata=entitlements,flags", "--timestamp=none", file]);
    await runFile("codesign", ["--verify", "--deep", "--strict", file]);
    return;
  }
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')",
    "$cert = Get-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $env:STARTUPBOT_SMOKE_CERT)",
    "$signed = Set-AuthenticodeSignature -FilePath $env:STARTUPBOT_SMOKE_SIGN_FILE -Certificate $cert -HashAlgorithm SHA256",
    "if ($signed.Status -ne 'Valid') { throw $signed.StatusMessage }",
  ].join("; ");
  await runFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    env: { ...process.env, STARTUPBOT_SMOKE_SIGN_FILE: file },
  });
}

async function build(version, target) {
  const output = join(root, version);
  await writeFile(join(project, "package.json"), JSON.stringify({
    name: "startupbot-update-fixture", version, description: product, author: "StartupBot", main: "main.cjs",
  }));
  await builder.build({
    projectDir: project,
    targets: (mac ? builder.Platform.MAC : builder.Platform.WINDOWS).createTarget(target),
    publish: "never",
    config: {
      appId: "ai.startupbot.fixture.update", productName: product,
      electronVersion: require("electron/package.json").version,
      directories: { output }, npmRebuild: false, files: ["*.cjs", "*.mjs", "package.json"],
      extraResources: [{ from: conf, to: "app-update.yml" }],
      mac: { identity: "-" }, win: { signAndEditExecutable: false },
      nsis: { artifactName: archive, runAfterFinish: false, differentialPackage: false, createDesktopShortcut: false, createStartMenuShortcut: false },
      ...(signing && !mac ? { afterPack: async ({ appOutDir }) => signFile(join(appOutDir, product + ".exe")) } : {}),
    },
  });
  if (target === "nsis") return join(output, archive);
  if (mac) {
    const bundle = join(output, process.arch === "arm64" ? "mac-arm64" : "mac", product + ".app");
    if (signing) await signFile(bundle);
    return join(bundle, "Contents", "MacOS", product);
  }
  return join(output, process.arch === "x64" ? "win-unpacked" : "win-" + process.arch + "-unpacked", product + ".exe");
}

async function useAsset(file) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  asset = { file, sha512: hash.digest("base64"), size: (await stat(file)).size };
}

async function launch(binary, mode, expectedVersion) {
  const resultFile = join(root, "result.json");
  await rm(resultFile, { force: true });
  await runFile(binary, ["--user-data-dir=" + join(root, "profile")], {
    env: { ...process.env, HOME: root, LOCALAPPDATA: root, STARTUPBOT_UPDATE_SMOKE_ROOT: root, STARTUPBOT_UPDATE_SMOKE_MODE: mode }, timeout: 90_000,
  });
  const result = JSON.parse(await readFile(resultFile, "utf8"));
  assert.equal(result.version, expectedVersion);
  assert.equal(result.workspace, workspace);
  if (mode === "corrupt" || mode === "unsigned") assert.equal(result.rejected, true);
}

try {
  await Promise.all([project, join(root, "profile"), join(root, "logs")].map(path => mkdir(path, { recursive: true })));
  await copyFile(join(base, "smoke-desktop-update-fixture.cjs"), join(project, "main.cjs"));
  await copyFile(join(base, "../electron/vendor/electron-updater.cjs"), join(project, "electron-updater.cjs"));
  for (const file of ["desktop-update-source.cjs", "updater-config.mjs"]) {
    await copyFile(join(base, "../electron", file), join(project, file));
  }
  await writeFile(join(root, "profile", "workspace.json"), workspace);
  await new Promise((accept, reject) => server.once("error", reject).listen(0, "127.0.0.1", accept));
  await writeFile(conf, JSON.stringify({
    provider: "generic", url: "http://127.0.0.1:" + server.address().port, channel: "fixture",
    updaterCacheDirName: "startupbot-update-fixture-cache", publisherName: [publisher],
  }));
  const binary = await build("1.0.0", "dir");
  await launch(binary, "corrupt", "1.0.0");
  await launch(binary, "reopen", "1.0.0");
  assert.ok(hits.includes("/" + archive), "Installer bytes were never requested");
  if (signing) {
    let installer;
    let installed;
    let expected;
    if (mac) {
      const next = await build("1.0.1", "dir");
      const nextBundle = dirname(dirname(dirname(next)));
      installer = join(root, archive);
      await runFile("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", nextBundle, installer]);
      installed = join(dirname(dirname(binary)), "Resources", "app.asar");
      expected = await readFile(join(nextBundle, "Contents", "Resources", "app.asar"));
    } else {
      installer = await build("1.0.1", "nsis");
      await useAsset(installer);
      await launch(binary, "unsigned", "1.0.0");
      await signFile(installer);
      installed = join(dirname(binary), "resources", "app.asar");
      expected = await readFile(join(dirname(installer), "win-unpacked", "resources", "app.asar"));
    }
    await useAsset(installer);
    await launch(binary, "upgrade", "1.0.0");
    const deadline = Date.now() + 90_000;
    while (!(await readFile(installed).catch(() => Buffer.alloc(0))).equals(expected)) {
      assert.ok(Date.now() < deadline, "Native updater did not replace the installed application after normal quit");
      await delay(500);
    }
    await launch(binary, "reopen", "1.0.1");
  }
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, hits, corruptDownloadRejected: true, signedUpgradeOnQuit: signing ? true : "not run", workspacePreserved: true }));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
