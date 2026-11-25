import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const candidates: Array<[string, string[]]> = process.platform === "win32"
  ? [["py", ["-3"]], ["python", []], ["python3", []]]
  : [["python3", []], ["python", []]];
const python = candidates.find(([cmd, args]) => spawnSync(cmd, [...args, "--version"], { stdio: "ignore" }).status === 0);
const paths = [
  "skills/catalog/byted-seedance-video-generate/scripts/video_generate.py",
  "skills/catalog/byted-seedream-image-generate/scripts/seedream_image_generate.py",
];

describe.skipIf(!python)("ByteDance media skill portability and privacy", () => {
  it.each(paths)("explains a missing dependency without hiding help: %s", (path) => {
    const [cmd, args] = python!;
    const run = (extra: string[]) => spawnSync(cmd, [...args, "-I", "-S", "-B", path, ...extra], {
      cwd: process.cwd(), encoding: "utf8", timeout: 15_000,
    });
    const help = run(["--help"]);
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout.toLowerCase()).toContain("usage:");
    const missing = run(["--prompt", "fixture"]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("Missing httpx");
    expect(missing.stderr).not.toContain("Traceback");
  });

  it("redacts a synthetic credential from errors while retaining uncertain task IDs", () => {
    const script = String.raw`
import asyncio, importlib.util, os, sys, types
from unittest.mock import patch
secret = 'AUDIT_ONLY_FAKE_TOKEN_93da'
os.environ['ARK_API_KEY'] = secret
httpx = types.ModuleType('httpx')
class HTTPError(Exception): pass
class HTTPStatusError(HTTPError):
    def __init__(self, response): self.response = response
httpx.HTTPError, httpx.HTTPStatusError = HTTPError, HTTPStatusError
sys.modules['httpx'] = httpx
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
video = load('test_video', 'skills/catalog/byted-seedance-video-generate/scripts/video_generate.py')
image = load('test_image', 'skills/catalog/byted-seedream-image-generate/scripts/seedream_image_generate.py')
response = types.SimpleNamespace(status_code=401, text='provider echoed ' + secret)
with patch.object(video, '_create_video_task', side_effect=HTTPStatusError(response)):
    result = asyncio.run(video._process_single_item({'video_name': 'fixture', 'prompt': 'test'}, 'model'))
    assert secret not in str(result) and result.error_detail['http_status'] == 401
with patch.object(video, '_get_task_status', side_effect=HTTPError('offline')):
    result = asyncio.run(video._poll_task_status('task-fixture', 'fixture', 1, 1))
    assert result.status == 'pending' and result.task_id == 'task-fixture'
with patch.object(image, '_call_image_api', side_effect=RuntimeError('echo ' + secret)):
    result = asyncio.run(image.handle_single_task(0, {'prompt': 'test'}, 'model', '5.0', 10))
    assert secret not in str(result) and '[redacted]' in str(result)
with patch.object(image, '_call_image_api', return_value={'error': {'message': 'echo ' + secret}}):
    result = asyncio.run(image.handle_single_task(0, {'prompt': 'test'}, 'model', '5.0', 10))
    assert secret not in str(result) and '[redacted]' in str(result)
`;
    const [cmd, args] = python!;
    const result = spawnSync(cmd, [...args, "-B", "-c", script], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 15_000,
    });
    expect(result.status, result.stderr || result.error?.message).toBe(0);
  });
});
