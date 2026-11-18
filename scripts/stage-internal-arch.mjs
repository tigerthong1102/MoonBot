import assert from 'node:assert/strict';
import { cp, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fileSha256 } from './package-payload.mjs';

export async function stageInternalArch(source, destination, arch) {
  assert(['arm64', 'x64'].includes(arch), 'Unsupported macOS architecture');
  const metadata = JSON.parse(await readFile(join(source, 'build-metadata.json'), 'utf8'));
  const artifacts = metadata.artifacts.filter(artifact => artifact.file.endsWith(`-${arch}.dmg`));
  assert.equal(artifacts.length, 1, 'Expected one installer for this architecture');
  const artifact = artifacts[0];
  assert(artifact.file === basename(artifact.file) && !artifact.file.includes('\\'), 'Installer must be a plain filename');
  const stat = await lstat(join(source, artifact.file));
  assert(stat.isFile() && !stat.isSymbolicLink(), 'Installer must be a regular file');
  assert.equal(stat.size, artifact.bytes, 'Installer size mismatch');
  assert.equal(await fileSha256(join(source, artifact.file)), artifact.sha256, 'Installer checksum mismatch');
  await mkdir(destination, { recursive: true });
  await cp(join(source, artifact.file), join(destination, artifact.file), { errorOnExist: true, force: false });
  await writeFile(join(destination, 'SHA256SUMS.txt'), `${artifact.sha256}  ${artifact.file}\n`);
  await writeFile(join(destination, 'build-metadata.json'), JSON.stringify({
    ...metadata, artifacts, artifactArchitecture: arch,
    qualification: metadata.smoke?.arch === arch && metadata.smoke?.status === 'PASS' ? 'native-smoke-pass' : 'build-only',
  }, null, 2) + '\n');
  await cp(join(source, 'smoke'), join(destination, 'smoke'), { recursive: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, destination: { type: 'string' }, arch: { type: 'string' } } });
  assert(values.source && values.destination && values.arch, '--source, --destination and --arch are required');
  await stageInternalArch(values.source, values.destination, values.arch);
}
