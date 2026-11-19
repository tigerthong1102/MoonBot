import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { resolveCli } from "./procs.ts";

function installedPython(): string | null {
  if (process.platform !== "win32") return null;
  if (process.env.pythonLocation) {
    const executable = join(process.env.pythonLocation, "python.exe");
    if (!existsSync(executable)) throw new Error("The configured Python executable for the Hermes fixture is missing.");
    return executable;
  }
  try {
    return execFileSync("python.exe", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8", timeout: 5000 }).trim();
  } catch (cause) {
    if (process.env.GITHUB_ACTIONS === "true") throw new Error("The Windows Hermes fixture requires Python on the runner.", { cause });
    return null;
  }
}

const python = installedPython();
const run = promisify(execFile);

it.skipIf(!python)("saves a portable Hermes CLI and probes version and ACP models in an isolated server", async () => {
  const fixture = await launchVerificationServer({});
  const { dataDir, url, logPath } = fixture.info;
  const root = join(dataDir, "portable Hermes & 测试");
  const home = join(dataDir, ".hermes");
  const shim = join(root, "hermes.bat");
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    }).catch((cause: unknown) => { throw new Error(`${method} ${path} failed`, { cause }); });
    const result = await response.json() as any;
    expect(response.ok, JSON.stringify(result)).toBe(true);
    return result;
  };
  try {
    mkdirSync(join(root, "hermes_cli"), { recursive: true });
    mkdirSync(home, { recursive: true });
    symlinkSync(dirname(python!), join(root, "python_embedded"), "junction");
    writeFileSync(shim, '@echo off\r\n"%PYTHON_EXE%" -m hermes_cli.main %*\r\n');
    writeFileSync(join(root, "hermes_cli", "__init__.py"), "");
    writeFileSync(join(root, "cli-config.yaml.example"), "model:\n  default: fixture/model\n  provider: openrouter\n");
    writeFileSync(join(root, ".env.example"), "OPENROUTER_API_KEY=fixture-only\n");
    writeFileSync(join(root, "hermes_cli", "main.py"), `import json, os, sys
from pathlib import Path
home = Path(os.environ["HERMES_HOME"])
with (home / "launches.jsonl").open("a", encoding="utf-8") as log:
    log.write(json.dumps({"args": sys.argv[1:], "root": os.environ["HERMES_ROOT"], "cwd": os.getcwd(), "home": str(home), "python": os.environ["HERMES_PYTHON"], "pip": os.environ["PIP_TARGET"], "terminal": os.environ["TERMINAL_CWD"], "foreign_key": os.environ.get("OPENAI_API_KEY")}) + "\\n")
if "--version" in sys.argv:
    print("Hermes 1.4.17")
    sys.exit(0)
if sys.argv[1:2] != ["acp"]:
    print(json.dumps(sys.argv[1:], ensure_ascii=False))
    sys.exit(0)
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        result = {"protocolVersion": 1, "agentCapabilities": {}}
    elif method == "session/new":
        result = {"sessionId": "fixture-session", "models": {"currentModelId": "fixture/acp-model", "availableModels": [{"modelId": "fixture/acp-model", "name": "Fixture ACP model"}]}}
    else:
        result = {"echo": msg.get("params")}
    if "id" in msg:
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}), flush=True)
`);
    const payload = ["payload", 'spaces & pipes | %PATH% "quotes"', "你好"];
    const resolved = resolveCli(relative(process.cwd(), shim), payload);
    const env = { ...process.env, HERMES_HOME: home, OPENAI_API_KEY: "must-be-cleared", TERMINAL_CWD: dataDir };
    const output = await run(resolved.command, resolved.args, { env, encoding: "utf8", timeout: 30_000 });
    expect(JSON.parse(output.stdout)).toEqual(payload);
    const protocol = resolveCli(shim, ["acp"]);
    const echo = run(protocol.command, protocol.args, { env, encoding: "utf8", timeout: 30_000 });
    echo.child.stdin!.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "echo", params: payload }) + "\n");
    const echoed = await echo;
    expect(JSON.parse(echoed.stdout).result.echo).toEqual(payload);
    expect(readFileSync(join(home, "config.yaml"), "utf8")).toContain("fixture/model");
    writeFileSync(join(home, ".env"), "OPENROUTER_API_KEY=preserve-fixture-key\n");
    await api("PATCH", "/api/instances/hermes", { cli: shim });
    const catalog = await api("GET", "/api/instances");
    const hermes = catalog.instances.find((instance: any) => instance.instanceId === "hermes");
    expect(hermes.cli).toBe(shim);
    expect(hermes.snapshot).toMatchObject({ state: "available", version: "Hermes 1.4.17" });
    const advertised = expect.objectContaining({ id: "fixture/acp-model", label: "Fixture ACP model" });
    const hermesModels = { instances: expect.arrayContaining([
      expect.objectContaining({ instanceId: "hermes", models: expect.objectContaining({ options: expect.arrayContaining([advertised]) }) }),
    ]) };
    await expect.poll(() => api("GET", "/api/instances"), { timeout: 30_000, interval: 250 }).toMatchObject(hermesModels);
    const models = await runControlOmb(["models", "--url", url]);
    expect(models).toMatchObject(hermesModels);
    const launches = readFileSync(join(home, "launches.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(launches.some((launch) => launch.args[0] === "--version")).toBe(true);
    expect(launches.some((launch) => launch.args[0] === "acp")).toBe(true);
    expect(launches[0]).toMatchObject({ root, cwd: root, home, terminal: dataDir, foreign_key: null });
    expect(launches[0].pip).toBe(join(root, "python_embedded", "Lib", "site-packages"));
    expect(readFileSync(join(home, ".env"), "utf8")).toBe("OPENROUTER_API_KEY=preserve-fixture-key\n");
    const evidencePath = `${logPath}.portable-hermes.json`;
    writeFileSync(evidencePath, JSON.stringify({ url, logPath, commands: [
      { method: "PATCH", path: "/api/instances/hermes", body: { cli: shim } },
      { method: "GET", path: "/api/instances" },
      { command: ["models", "--url", url] },
    ], hermes: hermes.snapshot, models, launches }, null, 2));
    console.log(JSON.stringify({ logPath, evidencePath }));
  } catch (cause) {
    const tail = readFileSync(logPath, "utf8").slice(-2000);
    throw new Error(`Portable Hermes fixture (server exit: ${fixture.child.exitCode ?? fixture.child.signalCode ?? "running"}):\n${tail}`, { cause });
  } finally {
    if (existsSync(join(root, "python_embedded"))) unlinkSync(join(root, "python_embedded"));
    await fixture.close();
  }
}, 120_000);
