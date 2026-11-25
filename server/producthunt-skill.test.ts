import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const candidates: Array<[string, string[]]> = process.platform === "win32"
  ? [["py", ["-3"]], ["python", []], ["python3", []]]
  : [["python3", []], ["python", []]];
const python = candidates.find(([cmd, args]) => spawnSync(cmd, [...args, "--version"], { stdio: "ignore" }).status === 0);

describe.skipIf(!python)("Product Hunt skill privacy and missing data", () => {
  it("never prints a synthetic credential in provider errors or treats missing counts as zero", () => {
    const script = String.raw`
import contextlib, io, json, os, sys, urllib.error
from unittest.mock import patch
sys.path.insert(0, os.path.abspath('skills/catalog/producthunt/scripts'))
import producthunt_api as api
secret = 'AUDIT_ONLY_FAKE_TOKEN_7d91'
os.environ['PRODUCTHUNT_ACCESS_TOKEN'] = secret
class Response:
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return json.dumps({'errors': [{'message': 'invalid ' + secret}]}).encode()
errors = [
    urllib.error.HTTPError('https://api.producthunt.com/', 401, 'unauthorized', {}, io.BytesIO(('echo=' + secret).encode())),
    RuntimeError('connection ' + secret),
]
for error in errors:
    output = io.StringIO()
    with patch('urllib.request.urlopen', side_effect=error), contextlib.redirect_stderr(output):
        try: api.graphql('query { viewer { id } }')
        except SystemExit: pass
    assert secret not in output.getvalue(), output.getvalue()
output = io.StringIO()
with patch('urllib.request.urlopen', return_value=Response()), contextlib.redirect_stderr(output):
    try: api.graphql('query { viewer { id } }')
    except SystemExit: pass
assert secret not in output.getvalue(), output.getvalue()
assert api.format_count(None) == 'N/A'
assert api.format_count(0) == '0'
`;
    const [cmd, args] = python!;
    const result = spawnSync(cmd, [...args, "-B", "-c", script], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 15_000,
    });
    expect(result.status, result.stderr || result.error?.message).toBe(0);
  });
});
