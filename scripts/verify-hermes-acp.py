"""Exercise an installed Hermes via stdio against a local synthetic provider and invoice.
Run: python3 scripts/verify-hermes-acp.py /absolute/path/to/hermes
The installed Hermes must include its acp and mcp extras.
The temporary profile keeps the wire transcript and diagnostic logs for inspection.
Model fixture and wire loop adapted from NousResearch/hermes-agent, MIT,
evals/acp_empty_session_wire.py at ab7e19a761e0ef52ef0d1c5f0417c5784c653446.
See third_party/hermes-agent/LICENSE.
"""

import json
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


if len(sys.argv) > 1 and sys.argv[1] == "mcp":
    # The only exposed tool returns a constant synthetic invoice; log its read out of band.
    for line in sys.stdin:
        request = json.loads(line)
        if "id" not in request:
            continue
        method = request["method"]
        if method == "initialize":
            result = {
                "protocolVersion": request["params"]["protocolVersion"],
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "fixture", "version": "1"},
            }
        elif method == "tools/list":
            result = {
                "tools": [
                    {
                        "name": "read_invoice",
                        "description": "Read a synthetic invoice",
                        "annotations": {"readOnlyHint": True},
                        "inputSchema": {"type": "object", "properties": {}},
                    }
                ]
            }
        elif method == "tools/call" and request["params"]["name"] == "read_invoice":
            Path(sys.argv[2]).write_text("INV-314 synthetic read")
            result = {"content": [{"type": "text", "text": "INV-314 synthetic read"}]}
        else:
            print(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": request["id"],
                        "error": {
                            "code": -32601,
                            "message": "Unsupported fixture method",
                        },
                    }
                ),
                flush=True,
            )
            continue
        print(
            json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}),
            flush=True,
        )
    sys.exit()

if len(sys.argv) != 2:
    sys.exit(__doc__)
executable = Path(sys.argv[1]).resolve(strict=True)
home = Path(tempfile.mkdtemp(prefix="hermes-acp-roundtrip-"))
print("Fixture:", home, flush=True)
hermes = home / ".hermes"
hermes.mkdir()
read = home / "read-result"
ready = threading.Event()
release = threading.Event()


class Model(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.respond({"object": "list", "data": [{"id": "fixture", "object": "model"}]})

    def respond(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        msgs = request.get("messages", [])
        tools = [t.get("function", {}).get("name", "") for t in request.get("tools", [])]
        fixture = next((t for t in tools if "read_invoice" in t), None)
        user = next((str(m["content"]) for m in reversed(msgs) if m.get("role") == "user"), "")
        Path(home / "last-model.json").write_text(
            json.dumps(
                {
                    "path": self.path,
                    "tools": tools,
                    "stream": request.get("stream"),
                    "user": user,
                    "roles": [m.get("role") for m in msgs],
                }
            )
        )
        if "CANCEL_FIXTURE" in user:
            ready.set()
            release.wait(timeout=20)
        role = "assistant"
        message = {"role": role, "content": "Local fixture reply."}
        reason = "stop"
        if not fixture and "tool_call" in tools:
            name = re.search(r"mcp__\w+__read_invoice", json.dumps([request.get("tools", []), msgs]))
            if name:
                arguments = json.dumps({"calls": [{"name": name.group(), "arguments": {}}]})
                fixture = "tool_call"
            else:
                arguments = json.dumps({"queries": ["read_invoice"]})
                fixture = "tool_search"
        else:
            arguments = "{}"
        if (
            fixture
            and "READ_FIXTURE" in user
            and len([m for m in msgs if m.get("role") == "tool"]) < 3
            and not read.exists()
        ):
            message = {
                "role": role,
                "content": None,
                "tool_calls": [
                    {
                        "index": 0,
                        "type": "function",
                        "id": "call-read",
                        "function": {"name": fixture, "arguments": arguments},
                    }
                ],
            }
            reason = "tool_calls"
        if request.get("stream"):
            chunk = {
                "id": "fixture-stream",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "fixture",
                "choices": [{"index": 0, "delta": message, "finish_reason": reason}],
            }
            data = ("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.respond(
            {
                "id": "fixture-completion",
                "object": "chat.completion",
                "created": 1,
                "model": "fixture",
                "choices": [{"index": 0, "message": message, "finish_reason": reason}],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                },
            }
        )


server = ThreadingHTTPServer(("127.0.0.1", 0), Model)
threading.Thread(target=server.serve_forever, daemon=True).start()
(hermes / "config.yaml").write_text(
    f"model:\n  provider: custom\n  default: fixture\n  base_url: http://127.0.0.1:{server.server_port}/v1\n  api_key: synthetic-local-key\n  api_mode: chat_completions\nmcp_servers: {{}}\nmemory:\n  memory_enabled: false\n  user_profile_enabled: false\n"
)
env = {
    k: os.environ[k]
    for k in (
        "LANG",
        "PATH",
        "TMPDIR",
        "TZ",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
    )
    if k in os.environ
}
env.update(
    HOME=str(home),
    USERPROFILE=str(home),
    APPDATA=str(home),
    LOCALAPPDATA=str(home),
    HERMES_HOME=str(hermes),
    PATH=str(executable.parent) + os.pathsep + env["PATH"],
)
proc = subprocess.Popen(
    [str(executable), "acp"],
    cwd=home,
    env=env,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=open(home / "stderr", "w"),
    text=True,
)
q = queue.Queue()


def listen():
    for line in proc.stdout:
        q.put(json.loads(line))


threading.Thread(target=listen, daemon=True).start()


def write(data):
    proc.stdin.write(json.dumps(data) + "\n")
    proc.stdin.flush()


def send(i, method, params):
    write(
        dict(
            jsonrpc="2.0",
            method=method,
            params=params,
            **({"id": i} if i is not None else {}),
        )
    )


def result(i, timeout=150):
    deadline = time.monotonic() + timeout
    while True:
        res = q.get(timeout=max(0.01, deadline - time.monotonic()))
        with (home / "wire").open("a") as out:
            print(json.dumps(res), file=out)
        if res.get("method") == "session/request_permission":
            opts = res["params"]["options"]
            allow = next(o for o in opts if o.get("kind") == "allow_once")
            write(
                dict(
                    jsonrpc="2.0",
                    id=res["id"],
                    result={
                        "outcome": {
                            "outcome": "selected",
                            "optionId": allow["optionId"],
                        }
                    },
                )
            )
        if res.get("id") == i and "method" not in res:
            if "error" in res:
                raise RuntimeError(res["error"])
            return res["result"]


try:
    send(
        1,
        "initialize",
        {
            "protocolVersion": 1,
            "clientCapabilities": {},
            "clientInfo": {"name": "startupbot-fixture", "version": "1"},
        },
    )
    init = result(1)
    print("initialize", init.get("agentInfo"), flush=True)
    params = {
        "cwd": str(home),
        "mcpServers": [
            {
                "name": "fixture",
                "command": sys.executable,
                "args": [str(Path(__file__).resolve()), "mcp", str(read)],
                "env": [],
            }
        ],
    }
    send(2, "session/new", params)
    sid = result(2)["sessionId"]
    print("new", sid, flush=True)

    def prompt(i, text):
        send(
            i,
            "session/prompt",
            dict(sessionId=sid, prompt=[{"type": "text", "text": text}]),
        )

    prompt(3, "READ_FIXTURE. Use read_invoice once.")
    print("read prompt", result(3, 100), flush=True)
    print("read evidence", read.read_text() if read.exists() else "absent", flush=True)
    send(4, "session/resume", dict(sessionId=sid, **params))
    result(4)
    print("resumed", True, flush=True)
    prompt(5, "CANCEL_FIXTURE")
    if not ready.wait(25):
        raise RuntimeError("cancel probe did not reach the local model")
    send(None, "session/cancel", dict(sessionId=sid))
    cancelled = result(5, 35)
    print("cancel", cancelled, flush=True)
    if not read.exists() or read.read_text() != "INV-314 synthetic read":
        raise RuntimeError("Hermes did not call the local read-only MCP tool")
    if cancelled.get("stopReason") != "cancelled":
        raise RuntimeError("Hermes did not acknowledge cancellation")
finally:
    release.set()
    proc.terminate()
    proc.wait(timeout=15)
    subprocess.run(
        [str(executable), "gateway", "stop"],
        cwd=home,
        env=env,
        capture_output=True,
        timeout=90,
    )
    server.shutdown()
