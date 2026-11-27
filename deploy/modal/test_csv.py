import sqlite3
import unittest

from csv_worker import inspect_csv
from run_csv import execute


class TestWorker(unittest.TestCase):
    def test_workload_counts_quoted_csv_without_returning_contents(self):
        result = inspect_csv.local(b'a,b\n"private\nvalue",0\nx\n')
        self.assertEqual((result["dataRows"], result["columns"], result["inconsistentRows"]), (2, 2, 1))
        self.assertNotIn("private", str(result))
        with self.assertRaises(ValueError):
            inspect_csv.local(b"a" * (1024 * 1024 + 1))

    def test_dedup_and_explicit_retry_preserve_unknown_costs(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        rates = {"containerUsdPerSecond": .001, "egressUsdPerGB": .1, "storageUsdPerJob": .002}
        calls = []
        def submit(_):
            calls.append(1)
            if len(calls) == 1:
                raise TimeoutError()
            return inspect_csv.local(b"a\nb\n")
        def run(retry=False, data=b"a\nb\n"):
            return execute(db, "job", data, rates, retry, submit)
        self.assertEqual(run()[0]["status"], "unconfirmed")
        self.assertEqual(run()[0]["attempt"], 1)
        rows = run(True)
        self.assertEqual([r["status"] for r in rows], ["unconfirmed", "completed"])
        self.assertGreaterEqual(rows[-1]["cost"]["estimateUsd"], .002)
        self.assertEqual(run(), rows)
        with self.assertRaises(ValueError):
            run(True, b"changed")
