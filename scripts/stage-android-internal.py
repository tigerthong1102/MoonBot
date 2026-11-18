import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

version = re.search(r'private val appVersionName = "([0-9.]+)"', Path('android/app/build.gradle.kts').read_text()).group(1)
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
source = Path('android/app/build/outputs')
evidence = Path('mobile-artifacts/android')
root = Path('mobile-artifacts/downloads/android')
for architecture in ('arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86', 'universal', 'bundle'):
    destination = root / architecture
    destination.mkdir(parents=True, exist_ok=False)
    if architecture == 'bundle':
        original = source / 'bundle/release/app-release.aab'
        name = f'StartupBot-{version}-UNSIGNED.aab'
    else:
        original = source / f'apk/debug/app-{architecture}-debug.apk'
        name = f'StartupBot-{version}-{architecture}-INTERNAL-debug.apk'
    shutil.copy2(original, destination / name)
    sha256 = hashlib.sha256((destination / name).read_bytes()).hexdigest()
    (destination / 'SHA256SUMS.txt').write_text(f'{sha256}  {name}\n')
    (destination / 'COMMIT.txt').write_text(commit + '\n')
    (destination / 'build-metadata.json').write_text(json.dumps({
        'commit': commit, 'version': version, 'architecture': architecture, 'file': name,
        'bytes': original.stat().st_size, 'sha256': sha256,
        'signing': 'unsigned' if architecture == 'bundle' else 'ephemeral-debug-key',
        'qualification': 'bundle-build-only' if architecture == 'bundle' else
                         'emulator-smoke-pass' if architecture == 'x86_64' else 'build-and-payload-verification-only',
    }, indent=2) + '\n')
    shutil.copytree(evidence, destination / 'evidence')
    for file in ('android/LICENSE', 'android/NOTICE', 'docs/STARTUPBOT_MOBILE_INTERNAL.md'):
        shutil.copy2(file, destination)
