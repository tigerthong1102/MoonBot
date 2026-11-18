import importlib.util
from pathlib import Path
import tempfile
import struct
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('apk_payload', Path(__file__).with_name('verify-android-apk-payload.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PayloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.common = {'classes.dex': b'code', 'resources.arsc': b'all locales',
                       'assets/model': b'offline qr model', 'AndroidManifest.xml': b'identity permissions version'}
        self.universal = self.root / 'universal.apk'
        self.write(self.universal, self.common | {f'lib/{abi}/scanner.so': abi.encode() for abi in module.ABIS})

    def write(self, file, entries):
        with zipfile.ZipFile(file, 'w') as archive:
            for name, value in entries.items():
                archive.writestr(name, value)

    def test_every_abi_keeps_all_common_bytes_and_matching_native_code(self):
        for abi in module.ABIS:
            apk = self.root / f'{abi}.apk'
            self.write(apk, self.common | {f'lib/{abi}/scanner.so': abi.encode()})
            self.assertEqual(module.verify(self.universal, apk, abi)['status'], 'PASS')

    def test_missing_or_changed_code_assets_permissions_and_native_libs_fail(self):
        good = self.common | {'lib/arm64-v8a/scanner.so': b'arm64-v8a'}
        for name in good:
            for remove in (False, True):
                with self.subTest(name=name, remove=remove):
                    changed = dict(good)
                    if remove:
                        del changed[name]
                    else:
                        changed[name] = b'tampered'
                    apk = self.root / 'bad.apk'
                    self.write(apk, changed)
                    with self.assertRaises(ValueError):
                        module.verify(self.universal, apk, 'arm64-v8a')

    def test_foreign_architecture_is_rejected(self):
        apk = self.root / 'mixed.apk'
        self.write(apk, self.common | {'lib/arm64-v8a/scanner.so': b'arm64-v8a', 'lib/x86/scanner.so': b'x86'})
        with self.assertRaises(ValueError):
            module.verify(self.universal, apk, 'arm64-v8a')

    def test_duplicate_entries_are_rejected(self):
        apk = self.root / 'duplicate.apk'
        with zipfile.ZipFile(apk, 'w') as archive:
            archive.writestr('classes.dex', b'a')
            archive.writestr('classes.dex', b'b')
        with self.assertRaises(ValueError):
            module.entries(apk)


class NativePagesTests(unittest.TestCase):
    def elf(self, alignment=16384, address=0, offset=0):
        binary = bytearray(120)
        binary[:6] = b'\x7fELF\x02\x01'
        struct.pack_into('<Q', binary, 32, 64)
        struct.pack_into('<HH', binary, 54, 56, 1)
        struct.pack_into('<IIQQQQQQ', binary, 64, 1, 0, offset, address, 0, 0, 0, alignment)
        return binary

    def test_accepts_aligned_16k_native_code(self):
        module.verify_elf_pages(self.elf())

    def test_rejects_4k_or_incongruent_segments(self):
        for binary in (self.elf(4096), self.elf(16384, address=4096), self.elf(20000)):
            with self.assertRaises(ValueError):
                module.verify_elf_pages(binary)

    def test_rejects_corrupt_or_missing_load_headers(self):
        binary = self.elf()
        struct.pack_into('<I', binary, 64, 0)
        for corrupt in (b'', self.elf()[:50], binary):
            with self.assertRaises(ValueError):
                module.verify_elf_pages(corrupt)


if __name__ == '__main__':
    unittest.main()
