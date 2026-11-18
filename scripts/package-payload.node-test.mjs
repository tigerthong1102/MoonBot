import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync, symlinkSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileSha256, verifyInstalledPayload } from './package-payload.mjs';
import { stageInternalArch } from './stage-internal-arch.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'startupbot-payload-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'); const installed = join(root, 'installed');
  mkdirSync(source); mkdirSync(join(source, 'browser'));
  writeFileSync(join(source, 'LICENSE'), 'retained attribution');
  writeFileSync(join(source, 'browser', 'engine'), 'unchanged executable');
  cpSync(source, installed, { recursive: true });
  return { root, source, installed };
}

test('identical installed files preserve every runtime component and license', async t => {
  const { source, installed } = fixture(t);
  const result = await verifyInstalledPayload(source, installed);
  assert.equal(result.status, 'PASS'); assert.equal(result.files, 2);
  assert.equal(result.manifestSha256.length, 64);
});

for (const mutation of ['changed', 'removed', 'added']) test(`rejects ${mutation} installed payload`, async t => {
  const { source, installed } = fixture(t);
  if (mutation === 'removed') unlinkSync(join(installed, 'LICENSE'));
  else writeFileSync(join(installed, mutation === 'changed' ? 'LICENSE' : 'unexpected'), 'different');
  await assert.rejects(verifyInstalledPayload(source, installed));
});

test('preserves POSIX executable modes and symlink targets', async t => {
  if (process.platform === 'win32') return t.skip('POSIX permission/link semantics');
  const { source, installed } = fixture(t);
  chmodSync(join(source, 'browser', 'engine'), 0o755);
  await assert.rejects(verifyInstalledPayload(source, installed));
  chmodSync(join(installed, 'browser', 'engine'), 0o755);
  symlinkSync('browser/engine', join(source, 'driver'));
  symlinkSync('LICENSE', join(installed, 'driver'));
  await assert.rejects(verifyInstalledPayload(source, installed));
  unlinkSync(join(installed, 'driver')); symlinkSync('browser/engine', join(installed, 'driver'));
  assert.equal((await verifyInstalledPayload(source, installed)).status, 'PASS');
});

test('permits only the expected Windows installer uninstaller outside the application payload', async t => {
  const { source, installed } = fixture(t);
  writeFileSync(join(installed, 'Uninstall StartupBot.exe'), 'installer-generated uninstaller');
  assert.equal((await verifyInstalledPayload(source, installed, 'win32')).status, 'PASS');
  writeFileSync(join(installed, 'another.exe'), 'unapproved');
  await assert.rejects(verifyInstalledPayload(source, installed, 'win32'));
});

test('architecture downloads contain one verified installer and honest native qualification', async t => {
  const { root, source } = fixture(t);
  const artifacts = [];
  for (const arch of ['arm64', 'x64']) {
    const file = `StartupBot-test-${arch}.dmg`;
    writeFileSync(join(source, file), arch);
    artifacts.push({ file, bytes: arch.length, sha256: await fileSha256(join(source, file)) });
  }
  mkdirSync(join(source, 'smoke')); writeFileSync(join(source, 'smoke', 'payload-integrity.json'), '{"status":"PASS"}');
  writeFileSync(join(source, 'build-metadata.json'), JSON.stringify({ commit: 'fixture-sha', artifacts, smoke: { arch: 'arm64', status: 'PASS' } }));
  for (const arch of ['arm64', 'x64']) {
    const destination = join(root, arch); await stageInternalArch(source, destination, arch);
    const metadata = JSON.parse(readFileSync(join(destination, 'build-metadata.json'), 'utf8'));
    assert.equal(metadata.artifacts.length, 1); assert.equal(metadata.commit, 'fixture-sha');
    assert.equal(metadata.qualification, arch === 'arm64' ? 'native-smoke-pass' : 'build-only');
    assert.equal(readFileSync(join(destination, 'SHA256SUMS.txt'), 'utf8').trim().split('\n').length, 1);
  }
  writeFileSync(join(source, artifacts[0].file), 'tampered');
  await assert.rejects(stageInternalArch(source, join(root, 'bad'), 'arm64'));
  await assert.rejects(stageInternalArch(source, join(root, 'bad-arch'), 'unknown'));
});
