import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { verifyInstalledPayload } from './package-payload.mjs';

const run = promisify(execFile);
const root = resolve('release/internal');
const evidence = join(root, 'smoke');
await mkdir(evidence, { recursive: true });
const images = (await readdir(root)).filter(name => name.endsWith('.dmg'));
assert(images.length, 'No disk images to compress');
const reports = [];
for (const image of images) {
  const arch = image.endsWith('-arm64.dmg') ? 'arm64' : image.endsWith('-x64.dmg') ? 'x64' : null;
  assert(arch, 'Unknown disk image architecture');
  const original = join(root, image);
  const source = join(root, arch === 'arm64' ? 'mac-arm64' : 'mac', 'StartupBot.app');
  const temp = await mkdtemp(join(tmpdir(), 'startupbot-compression-'));
  const compressed = join(temp, image);
  const volume = join(temp, 'volume');
  let mounted = false;
  try {
    await run('hdiutil', ['convert', original, '-format', 'ULMO', '-tasks', '2', '-o', compressed], { timeout: 600_000 });
    await run('hdiutil', ['verify', compressed], { timeout: 90_000 });
    await mkdir(volume);
    await run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', volume, compressed], { timeout: 90_000 });
    mounted = true;
    const payload = await verifyInstalledPayload(source, join(volume, 'StartupBot.app'));
    await run('codesign', ['--verify', '--deep', '--strict', join(volume, 'StartupBot.app')], { timeout: 90_000 });
    await run('hdiutil', ['detach', volume], { timeout: 45_000 });
    mounted = false;
    const beforeBytes = (await stat(original)).size;
    const candidateBytes = (await stat(compressed)).size;
    if (candidateBytes < beforeBytes) {
      await copyFile(compressed, original + '.next');
      await rename(original + '.next', original);
    }
    const afterBytes = Math.min(beforeBytes, candidateBytes);
    reports.push({ image, arch, beforeBytes, afterBytes, savedPercent: 100 * (beforeBytes - afterBytes) / beforeBytes,
      format: candidateBytes < beforeBytes ? 'ULMO' : 'UDZO', payload });
    console.log(JSON.stringify(reports.at(-1)));
  } finally {
    if (mounted) await run('hdiutil', ['detach', volume], { timeout: 45_000 });
    await rm(temp, { recursive: true, force: true });
  }
}
await writeFile(join(evidence, 'compression.json'), JSON.stringify({ status: 'PASS', images: reports }, null, 2) + '\n');
