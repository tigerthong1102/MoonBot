"""Exercise the packaged PowerShell entry point with disposable local sources."""
import hashlib
from html import unescape
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET

SCRIPTS = Path(__file__).resolve().parents[3] / "skills/kiem-toan/scripts"
FIELDS = dict(company="company", period="period", key="number", amount="amount", label="label")
ROWS = [
    ("A", "2026-08", "00017", "-100.1200", "Đắk Lắk"),
    ("A", "2026-08", "001", "2.3000", "Hàng"),
    ("A", "2026-08", "001", "1.0000", "Hàng"),
    ("B", "2026-08", "00017", "9000", "Khác"),
    ("A", "2026-07", "00017", "8000", "Khác"),
]
COLS = ["company", "period", "number", "amount", "label"]


def make_xml(path, rows):
    root = ET.Element("sales", xmlns="urn:demo")
    for row in rows:
        item = ET.SubElement(root, "row")
        for key, value in zip(COLS, row):
            ET.SubElement(item, key).text = value
    path.write_bytes(ET.tostring(root, encoding="utf-8"))


def make_xlsx(path, rows, formula=False, numeric_id=False):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/workbook.xml", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" r:id="r1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="r1" Type="s/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        sheet = ET.Element("worksheet")
        data = ET.SubElement(sheet, "sheetData")
        for n, values in enumerate([COLS, *rows], 1):
            row = ET.SubElement(data, "row", r=str(n))
            for i, value in enumerate(values):
                numeric = n > 1 and (i == 3 or (i == 2 and numeric_id))
                cell = ET.SubElement(row, "c", r=f"{chr(65+i)}{n}", t="n" if numeric else "inlineStr")
                if numeric:
                    ET.SubElement(cell, "v").text = value
                else:
                    ET.SubElement(ET.SubElement(cell, "is"), "t").text = value
                if formula and n == 2 and i == 3:
                    ET.SubElement(cell, "f").text = "1+1"
        z.writestr("xl/worksheets/sheet1.xml", ET.tostring(sheet, encoding="utf-8"))


class AuditSkill(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.path = Path(self.work.name)
        self.xml, self.xlsx = self.path / "source.xml", self.path / "control.xlsx"
        make_xml(self.xml, ROWS)
        make_xlsx(self.xlsx, ROWS)
        self.left = dict(path=str(self.xml), recordPath="/sales/row", namespace="urn:demo", fields=FIELDS.copy())
        self.right = dict(path=str(self.xlsx), sheet="Data", fields=FIELDS.copy())
        self.counter = 0

    def run_job(self, op, fail=False, html=False, **args):
        job = dict(op=op, left=self.left, scope=dict(company="A", period="2026-08"))
        if op == "compare":
            job["right"] = self.right
        job.update(args)
        config = self.path / "job.json"
        config.write_text(json.dumps(job), encoding="utf-8")
        self.counter += 1
        report = self.path / f"report-{self.counter}.{'html' if html else 'json'}"
        proc = subprocess.run([os.environ.get("AUDIT_PWSH", "pwsh"), "-NoProfile", "-NonInteractive", "-File",
                               str(SCRIPTS / "audit.ps1"), "-JobFile", str(config), "-OutFile", str(report)],
                              capture_output=True, timeout=30)
        if isinstance(fail, bytes):
            self.assertIn(fail, proc.stderr)
        if fail:
            self.assertNotEqual(proc.returncode, 0)
            self.assertFalse(report.exists())
            return
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn(b"00017", proc.stdout)
        self.assertNotIn(b"-100", proc.stdout)
        content = report.read_text(encoding="utf-8-sig")
        return content if html else json.loads(content)

    def test_search_and_scope(self):
        r = self.run_job("find", where=[dict(field="label",op="contains",value="đắk")],select=["key","label"])
        self.assertEqual([(v["key"],v["row"]) for v in r["matches"]], [("00017",1)])
        self.assertEqual(r["left"]["scopedRows"], 3)
        self.assertEqual(self.run_job("total",where=[dict(field="amount",op="below",value="0")])["left"]["total"], "-100.1200")
        self.assertEqual(self.run_job("total",scope=dict(company="C",period="2026-08"))["left"]["selectedRows"],0)

    def test_comparison(self):
        control = [("A","2026-08","00017","-100.1100","khác"),
                   ("A","2026-08","001","3.3000","Hàng"), ("A","2026-08","X","0","Hàng")]
        make_xlsx(self.xlsx,control)
        r = self.run_job("compare", compareFields=["label"])
        diffs = {v["key"]:v for v in r["exceptions"]}
        self.assertEqual(diffs["00017"]["difference"], "-0.0100")
        self.assertEqual(diffs["00017"]["differentFields"], ["label"])
        self.assertEqual(diffs["001"]["status"], "review_grain")
        self.assertEqual(diffs["X"]["status"], "only_right")
        self.assertIsNone(diffs["X"]["leftAmount"])
        html = self.run_job("compare",html=True,compareFields=["label"])
        self.assertIn("Chỉ có ở B", unescape(html))
        self.assertIn("-0.0100", html)
        swapped = self.run_job("compare",left=self.right,right=self.left)
        self.assertIn("only_left",[v["status"] for v in swapped["exceptions"]])
        make_xlsx(self.xlsx,[(*ROWS[0][:-1],"khác"),*ROWS[1:]])
        self.assertIn("field_difference",[v["status"] for v in self.run_job("compare",compareFields=["label"])["exceptions"]])

    def test_voucher_numbers_that_are_dictionary_properties(self):
        rows = [("A", "2026-08", key, "1", "Q") for key in ("Keys", "Count", "Values", "002")]
        make_xml(self.xml, rows)
        make_xlsx(self.xlsx, rows)
        result = self.run_job("compare")
        self.assertEqual((result["keys"], result["matched"], result["exceptions"]), (4, 4, []))

    def test_inspect_and_scope_binding(self):
        self.assertEqual(self.run_job("inspect",left=dict(path=str(self.xlsx)))["source"]["sheets"],["Data"])
        self.assertEqual(self.run_job("inspect",left=dict(path=str(self.xml)))["source"]["paths"]["/sales/row"],5)
        # A file authorized as single company still needs a matching digest and evidence.
        make_xml(self.xml,[ROWS[0]])
        self.left["fields"].pop("company")
        self.left.update(bind={"company":"A"},evidence="fixture header",sha256=hashlib.sha256(self.xml.read_bytes()).hexdigest())
        self.assertEqual(self.run_job("total")["left"]["total"], "-100.1200")
        make_xml(self.xml,[ROWS[1]])
        self.run_job("total",fail=True)

    def test_local_html_escapes_source(self):
        make_xml(self.xml,[("A","2026-08","<script>","0","<label>")])
        html = self.run_job("find",html=True,select=["label"])
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;",html)
        self.assertIn("Content-Security-Policy",html)

    def test_network_paths_are_rejected_before_open(self):
        self.run_job("inspect", left=dict(path="//reserved.invalid/share/file.xlsx"), fail=b"AUDIT_LOCAL_PATH_REQUIRED")

    def test_invalid_inputs(self):
        make_xlsx(self.xlsx, ROWS, formula=True)
        self.run_job("compare",fail=True)
        make_xlsx(self.xlsx, ROWS, numeric_id=True)
        self.run_job("compare",fail=True)
        self.xml.write_text('<!DOCTYPE e [<!ENTITY a "x">]><sales/>')
        self.run_job("total",fail=True)
        make_xml(self.xml,[("A","2026-08","1","1,2.3","x")])
        self.run_job("total",fail=True)
        self.run_job("compare",scope={"company":"A"},fail=True)


if __name__ == "__main__":
    unittest.main()
