import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export async function fileSha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function payloadManifest(directory, platform = process.platform) {
  const entries = [];
  async function visit(folder, relative = '') {
    const stat = await lstat(folder);
    const mode = platform === 'win32' ? {} : { mode: stat.mode & 0o777 };
    if (stat.isSymbolicLink()) entries.push({ path: relative, type: 'link', target: await readlink(folder) });
    else if (stat.isDirectory()) {
      entries.push({ path: relative, type: 'directory', ...mode });
      for (const child of (await readdir(folder)).sort()) await visit(join(folder, child), relative ? `${relative}/${child}` : child);
    } else if (stat.isFile()) entries.push({ path: relative, type: 'file', bytes: stat.size, sha256: await fileSha256(folder), ...mode });
    else throw new Error(`Unsupported package entry: ${relative}`);
  }
  await visit(directory);
  return entries;
}

export async function verifyInstalledPayload(source, installed, platform = process.platform) {
  const expected = await payloadManifest(source, platform);
  const actual = await payloadManifest(installed, platform);
  const paths = new Set(expected.map(entry => entry.path));
  const extra = actual.filter(entry => !paths.has(entry.path));
  assert(extra.every(entry => platform === 'win32' && entry.path === 'Uninstall StartupBot.exe' && entry.type === 'file'), 'Unexpected installed payload entries');
  assert.deepEqual(actual.filter(entry => paths.has(entry.path)), expected, 'Installer changed or removed application bytes, permissions or symlinks');
  return {
    status: 'PASS',
    files: expected.filter(entry => entry.type === 'file').length,
    bytes: expected.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0),
    manifestSha256: createHash('sha256').update(JSON.stringify(expected)).digest('hex'),
    installerExtras: extra.map(entry => entry.path),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, installed: { type: 'string' }, report: { type: 'string' } } });
  assert(values.source && values.installed && values.report, '--source, --installed and --report are required');
  const report = await verifyInstalledPayload(values.source, values.installed);
  await writeFile(values.report, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
