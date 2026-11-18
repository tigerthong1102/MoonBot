import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest

import sys
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("simulator_install", Path(__file__).with_name("install-ios-simulator.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SimulatorInstallationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="startupbot-install-")
        self.addCleanup(self.folder.cleanup)
        self.app = Path(self.folder.name) / "StartupBot.app"
        self.app.mkdir()
        self.info = dict(CFBundleIdentifier="ai.startupbot.ios", CFBundleShortVersionString="0.1.2", CFBundleVersion="9", CFBundleExecutable="StartupBot")
        (self.app / "Info.plist").write_bytes(plistlib.dumps(self.info))
        (self.app / "StartupBot").write_bytes(b"new-binary")

    def command(self, install_codes, container=None):
        calls = []
        codes = iter(install_codes)

        def execute(command, seconds):
            calls.append((command[2], seconds))
            return (next(codes), "") if command[2] == "install" else (0, str(container or self.app))

        return execute, calls

    def test_success_requires_verified_payload(self):
        command, calls = self.command([0])
        result = module.install("owned-simulator", self.app, command, lambda _: None)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(calls, [("install", 90), ("get_app_container", 30)])

    def test_timeout_is_recovered_only_after_exact_payload_verification(self):
        command, _ = self.command([124])
        result = module.install("owned-simulator", self.app, command, lambda _: None)
        self.assertEqual(result["installExitCodes"], [124])
        self.assertEqual(result["verifiedInstalledPayload"], module.identity(self.app))

    def test_explicit_install_error_is_not_accepted(self):
        command, calls = self.command([7])
        with self.assertRaisesRegex(RuntimeError, "exit 7"):
            module.install("owned-simulator", self.app, command, lambda _: None)
        self.assertEqual(len(calls), 1)

    def test_timeout_retry_is_bounded_and_never_reports_uninstalled_payload_as_pass(self):
        command, calls = self.command([124, 124], Path(self.folder.name) / "absent.app")
        with self.assertRaisesRegex(RuntimeError, "installation deadline"):
            module.install("owned-simulator", self.app, command, lambda _: None)
        self.assertEqual([seconds for operation, seconds in calls if operation == "install"], [90, 180])
        self.assertEqual(len(calls), 8)

    def test_successful_install_with_wrong_executable_still_fails(self):
        other = Path(self.folder.name) / "other.app"
        other.mkdir()
        (other / "Info.plist").write_bytes(plistlib.dumps(self.info))
        (other / "StartupBot").write_bytes(b"old-binary")
        command, _ = self.command([0], other)
        with self.assertRaisesRegex(RuntimeError, "installation deadline"):
            module.install("owned-simulator", self.app, command, lambda _: None)

    def test_debug_dylib_must_match_even_when_launcher_is_identical(self):
        (self.app / "StartupBot.debug.dylib").write_bytes(b"new-code")
        other = Path(self.folder.name) / "old-debug.app"
        other.mkdir()
        (other / "Info.plist").write_bytes(plistlib.dumps(self.info))
        (other / "StartupBot").write_bytes(b"new-binary")
        (other / "StartupBot.debug.dylib").write_bytes(b"old-code")
        self.assertIsNone(module.installed_payload("owned-simulator", module.identity(self.app), self.command([], other)[0], lambda _: None))

    def test_wrong_version_or_bundle_is_rejected(self):
        for field, value in [("CFBundleVersion", "8"), ("CFBundleIdentifier", "other.app")]:
            with self.subTest(field=field):
                other = Path(self.folder.name) / field
                other.mkdir()
                (other / "Info.plist").write_bytes(plistlib.dumps(self.info | {field: value}))
                (other / "StartupBot").write_bytes(b"new-binary")
                self.assertIsNone(module.installed_payload("owned-simulator", module.identity(self.app), self.command([], other)[0], lambda _: None))


if __name__ == "__main__":
    unittest.main()
