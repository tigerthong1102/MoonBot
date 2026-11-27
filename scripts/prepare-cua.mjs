// Stage the macOS CUA executable and native SDK outside ASAR. The npm SDK does
// not ship the `cua-driver` CLI, so packaging fails loudly without one.
// Build the pinned CUA source with the checked macOS accessibility patch.
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, chmod, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { resolveCuaMacArches } from "./cua-mac-arches.mjs";
import { LIPO_ARCH, writeThinMachO } from "./mac-thin.mjs";

if (process.platform !== "darwin") throw new Error("prepare-cua is macOS-only");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const stage = join(root, "dist-native");
const sdkEntry = fileURLToPath(import.meta.resolve("@trycua/cua-driver"));
const sdkRoot = realpathSync(join(dirname(sdkEntry), ".."));
const dependencyRoot = join(sdkRoot, "..", "..");
const sdkPackage = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8"));
const expectedVersion = String(sdkPackage.version);
const release = {
  version: "0.45.4",
  revision: "d96e1bc359b2cc638c7a406aad01a7276b1b416f",
  sha256: "2617f50e62450f1e249902d958cf3a08fe5c6250ee50523127feea573f21a485",
};
const proofVersion = "startupbot-ax-proof-v1";
const patchFile = join(root, "third_party", "cua-driver", "macos-saved-steps.patch");
const patch = await readFile(patchFile);
const patchDigest = createHash("sha256").update(patch).digest("hex");
const MAC_ARCHES = resolveCuaMacArches(process.env);
if (expectedVersion !== release.version) throw new Error(`Unsupported CUA SDK version ${expectedVersion}`);

async function validBinary(candidate) {
  if (!candidate || !existsSync(candidate)) return false;
  try {
    const version = await run(candidate, ["--version"], { timeout: 5000 });
    const proof = await run(candidate, ["--startupbot-ax-proof-version"], { timeout: 5000 });
    return version.stdout.match(/cua-driver\s+([\d.]+)/)?.[1] === expectedVersion && proof.stdout.trim() === proofVersion;
  } catch { return false; }
}

async function buildCommand(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code ?? signal})`)));
  });
}

async function patchedBinary() {
  const cacheRoot = join(root, "node_modules", ".cache", "openmausbot");
  const cache = join(cacheRoot, `cua-${release.version}-${patchDigest}-${MAC_ARCHES.join("-")}`);
  const candidate = join(cache, "cua-driver");
  if (await validBinary(candidate)) return candidate;
  await mkdir(cacheRoot, { recursive: true });
  const temp = await mkdtemp(join(cacheRoot, "cua-build-"));
  try {
    const archive = join(cacheRoot, `cua-source-${release.revision}.tar.gz`);
    let bytes = await readFile(archive).catch(() => null);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== release.sha256) {
      const response = await fetch(`https://codeload.github.com/trycua/cua/tar.gz/${release.revision}`, { headers: { "user-agent": "StartupBot-packager" } });
      if (!response.ok) throw new Error(`CUA source download failed: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (createHash("sha256").update(bytes).digest("hex") !== release.sha256) throw new Error("CUA source checksum mismatch");
      const download = join(temp, "source.tar.gz");
      await writeFile(download, bytes);
      await rename(download, archive);
    }
    const source = join(temp, "source");
    await mkdir(source);
    const prefix = `cua-${release.revision}`;
    await run("/usr/bin/tar", ["-xzf", archive, "--strip-components=1", "-C", source, `${prefix}/libs/cua-driver`, `${prefix}/libs/cua`, `${prefix}/libs/images/sandbox-images.json`]);
    await run("git", ["init", "--quiet"], { cwd: source });
    await run("git", ["apply", patchFile], { cwd: source });
    const cwd = join(source, "libs", "cua-driver", "rust");
    const targets = MAC_ARCHES.map((arch) => arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin");
    const rustup = process.env.STARTUPBOT_RUSTUP || "rustup";
    await buildCommand(rustup, ["toolchain", "install", "1.97.1", "--profile", "minimal", ...targets.flatMap((target) => ["--target", target])], cwd);
    const binaries = [];
    for (const target of targets) {
      await buildCommand(rustup, ["run", "1.97.1", "cargo", "build", "--locked", "--release", "-p", "cua-driver", "--target", target], cwd);
      const targetDirectory = process.env.CARGO_TARGET_DIR ? resolve(cwd, process.env.CARGO_TARGET_DIR) : join(cwd, "target");
      binaries.push(join(targetDirectory, target, "release", "cua-driver"));
    }
    const built = join(temp, "cua-driver");
    if (binaries.length === 1) await copyFile(binaries[0], built);
    else await run("/usr/bin/lipo", ["-create", ...binaries, "-output", built]);
    await chmod(built, 0o755);
    if (!(await validBinary(built))) throw new Error("Patched CUA driver capability verification failed");
    await mkdir(cache, { recursive: true });
    const staged = join(cache, `cua-driver-${process.pid}`);
    await copyFile(built, staged);
    await chmod(staged, 0o755);
    await rename(staged, candidate);
    return candidate;
  } finally { await rm(temp, { recursive: true, force: true }); }
}

const binary = process.env.CUA_DRIVER_PATH || await patchedBinary();
if (!(await validBinary(binary))) throw new Error("CUA_DRIVER_PATH must point to a compatible patched CUA driver");
const details = await stat(binary);
if (!details.isFile() || (details.mode & 0o111) === 0) {
  throw new Error(`cua-driver is not an executable file: ${binary}`);
}

// Each mac arch's staging dir (picked via ${arch} in extraResources) gets only
// its own slice of the universal driver and SDK files. The driver is asserted
// universal, so a non-universal pin fails here rather than on an Intel Mac.
const { stdout: archList } = await run("/usr/bin/lipo", ["-archs", binary]);
for (const arch of MAC_ARCHES) {
  const lipoName = LIPO_ARCH[arch];
  if (!archList.trim().split(/\s+/).includes(lipoName)) {
    throw new Error(`cua-driver at ${binary} is not universal: has [${archList.trim()}], needs ${lipoName}`);
  }
}

for (const arch of MAC_ARCHES) {
  const archStage = join(stage, arch);
  await rm(archStage, { recursive: true, force: true });
  await mkdir(archStage, { recursive: true });
  await writeThinMachO(binary, join(archStage, "cua-driver"), LIPO_ARCH[arch]);
  await chmod(join(archStage, "cua-driver"), 0o755);
  // A binary copied out of CuaDriver.app keeps a bundle-relative signature whose
  // Info.plist is gone; electron-builder replaces this temporary one.
  await run("/usr/bin/codesign", ["--force", "--sign", "-", "--options", "runtime", join(archStage, "cua-driver")]);

  const nativeDir = join(archStage, "cua-sdk", "native");
  const nativePackage = join(dependencyRoot, "@trycua", `cua-driver-darwin-${arch}`);
  if (!existsSync(nativePackage)) {
    throw new Error(
      `required CUA darwin-${arch} native package is missing — is supportedArchitectures.cpu set in pnpm-workspace.yaml?`,
    );
  }
  await mkdir(nativeDir, { recursive: true });
  await Promise.all(["libcua_driver_sdk.dylib", "cua_driver_node_runtime.node"].map((name) =>
    writeThinMachO(join(realpathSync(nativePackage), name), join(nativeDir, name), LIPO_ARCH[arch])));
}

// One ESM file, so electron-builder's node_modules exclusion cannot drop it. The
// SDK's @ubjs native lookups are redirected to the files staged beside it.
const bundle = join(stage, MAC_ARCHES[0], "cua-sdk", "cua-sdk.mjs");
await build({
  stdin: {
    contents: [
      'export { EmbeddedCuaDriverHost } from "@trycua/cua-driver/embedded";',
      'export { requestMacOSPermissions, hasRequiredMacOSPermissions } from "@trycua/cua-driver/electron";',
    ].join("\n"),
    resolveDir: root,
    sourcefile: "openmausbot-cua-entry.mjs",
    loader: "js",
  },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: {
    js: 'import { createRequire as __openmausbotCreateRequire } from "node:module"; const require = __openmausbotCreateRequire(import.meta.url);',
  },
  outfile: bundle,
  logLevel: "silent",
});
const bundledSource = await readFile(bundle, "utf8");
const resolverPattern = /function resolveLibPath\d*\(opts\) \{/g;
const resolvers = bundledSource.match(resolverPattern) ?? [];
if (resolvers.length !== 1) {
  throw new Error("could not patch the bundled CUA native-library resolver");
}
await writeFile(
  bundle,
  bundledSource.replace(
    resolverPattern,
    `${resolvers[0]}\n      if (process.env.OPENMAUSBOT_CUA_SDK_LIBRARY) return resolveOverride(opts.crateName, process.env.OPENMAUSBOT_CUA_SDK_LIBRARY);`,
  ),
);

for (const arch of MAC_ARCHES.slice(1)) {
  await copyFile(bundle, join(stage, arch, "cua-sdk", "cua-sdk.mjs"));
}

console.log(`Staged CUA for ${MAC_ARCHES.join(" + ")} from ${binary}`);
