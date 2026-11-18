import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = str(Path(__file__).with_name('mobile-command.py'))


class MobileCommandTests(unittest.TestCase):
    def run_tool(self, seconds, code):
        return subprocess.run([sys.executable, SCRIPT, str(seconds), sys.executable, '-c', code], capture_output=True, text=True, timeout=5)

    def test_success_preserves_output(self):
        result = self.run_tool(2, 'print("StartupBot tool result")')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), 'StartupBot tool result')

    def test_failure_is_not_success(self):
        result = self.run_tool(2, 'raise SystemExit(7)')
        self.assertEqual(result.returncode, 7)

    def test_deadline_kills_and_reaps_the_owned_tool(self):
        with tempfile.TemporaryDirectory(prefix='startupbot-command-') as folder:
            pid_file = Path(folder) / 'pid'
            code = f'import os,time; from pathlib import Path; Path({str(pid_file)!r}).write_text(str(os.getpid())); time.sleep(60)'
            result = self.run_tool(0.5, code)
            self.assertEqual(result.returncode, 124)
            self.assertIn('Timed out', result.stderr)
            with self.assertRaises(ProcessLookupError):
                os.kill(int(pid_file.read_text()), 0)


if __name__ == '__main__':
    unittest.main()
