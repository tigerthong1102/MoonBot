import argparse
import hashlib
import json
import struct
from pathlib import Path
import zipfile

ABIS = ('arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86')


def entries(file):
    with zipfile.ZipFile(file) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate APK entries')
        return {name: hashlib.sha256(archive.read(name)).hexdigest()
                for name in names if not name.endswith('/') and not name.startswith('META-INF/')}


def verify_elf_pages(binary):
    if binary[:4] != b'\x7fELF' or binary[4:6] != b'\x02\x01':
        raise ValueError('Expected little-endian ELF64 native library')
    try:
        offset = struct.unpack_from('<Q', binary, 32)[0]
        size, count = struct.unpack_from('<HH', binary, 54)
        if size < 56 or not count or offset + size * count > len(binary):
            raise ValueError('Invalid ELF program headers')
        loads = 0
        for index in range(count):
            kind, _, file_offset, address, _, _, _, alignment = struct.unpack_from('<IIQQQQQQ', binary, offset + index * size)
            if kind == 1:
                loads += 1
                if alignment < 16384 or alignment & (alignment - 1) or (file_offset - address) % 16384:
                    raise ValueError('Native library does not support 16 KB pages')
        if not loads:
            raise ValueError('ELF has no loadable segments')
    except struct.error as error:
        raise ValueError('Truncated ELF program headers') from error


def verify_native_pages(file):
    with zipfile.ZipFile(file) as archive:
        libraries = [name for name in archive.namelist() if name.startswith(('lib/arm64-v8a/', 'lib/x86_64/')) and name.endswith('.so')]
        if not libraries:
            raise ValueError('Expected 64-bit native libraries')
        for name in libraries:
            verify_elf_pages(archive.read(name))
    return {'status': 'PASS', 'libraries': len(libraries), 'pageBytes': 16384}


def verify(universal, specialized, abi):
    if abi not in ABIS:
        raise ValueError('Unsupported ABI')
    reference = entries(universal)
    actual = entries(specialized)
    expected = {name: digest for name, digest in reference.items()
                if not name.startswith('lib/') or name.startswith(f'lib/{abi}/')}
    if not any(name.startswith(f'lib/{abi}/') for name in expected):
        raise ValueError('Universal APK lacks this ABI')
    if actual != expected:
        changed = sorted(name for name in actual.keys() | expected.keys() if actual.get(name) != expected.get(name))
        raise ValueError(f'APK payload mismatch: {changed}')
    return {'status': 'PASS', 'abi': abi, 'entries': len(expected),
            'universalBytes': Path(universal).stat().st_size, 'apkBytes': Path(specialized).stat().st_size,
            'payloadSha256': hashlib.sha256(json.dumps(expected, sort_keys=True).encode()).hexdigest()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    directory = Path(args.directory)
    results = [verify(directory / 'app-universal-debug.apk', directory / f'app-{abi}-debug.apk', abi) for abi in ABIS]
    Path(args.report).write_text(json.dumps({'status': 'PASS', 'packages': results, 'nativePages': verify_native_pages(directory / 'app-universal-debug.apk')}, indent=2) + '\n')
    print(json.dumps(results))
