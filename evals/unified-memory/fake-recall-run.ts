import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { devNull } from "node:os";
import { fakeRecall, type FakeMode } from "./fake-recall.ts";
import { corpusSha256 } from "./predictions.ts";
import type { MemoryCase } from "./score.ts";

const args = process.argv.slice(2);
if (args.length !== 2 || !["--context", "--question-only"].includes(args[0]!) || !["--fake=same", "--fake=none", "--fake=error"].includes(args[1]!)) {
  throw new Error("usage: fake-recall-run.ts (--context|--question-only) (--fake=same|--fake=none|--fake=error)");
}
const contextual = args[0] === "--context";
const mode = args[1]!.slice("--fake=".length) as FakeMode;
const bytes = readFileSync(new URL(contextual ? "./context-cases.json" : "./cases.json", import.meta.url));
const corpus = JSON.parse(bytes.toString("utf8")) as { version: number; cases: MemoryCase[] };
const root = fileURLToPath(new URL("../../", import.meta.url));
const gitEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR, TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: "0" };
const git = (args: string[]) => execFileSync("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], { encoding: "utf8", env: gitEnv });
const commit = git(["rev-parse", "HEAD"]).trim();
const previewSha256 = corpusSha256(readFileSync(new URL("../../server/ai-twin-preview.ts", import.meta.url)));
const redactorSha256 = corpusSha256(readFileSync(new URL("../../shared/redact.ts", import.meta.url)));
const adapterSha256 = corpusSha256(readFileSync(new URL("./fake-recall.ts", import.meta.url)));
const runnerSha256 = corpusSha256(readFileSync(new URL("./fake-recall-run.ts", import.meta.url)));
const dirty = Boolean(git(["status", "--porcelain"]).trim());
const result = await fakeRecall(corpus.cases, mode);
console.log(JSON.stringify({
  corpusVersion: corpus.version, corpusSha256: corpusSha256(bytes),
  metadata: { kind: "deterministic-fake", provider: "in-process fake", model: mode, commit, dirty, previewSha256, redactorSha256, adapterSha256, runnerSha256, calls: result.calls, cost: 0, network: "not-sandboxed", generatedAt: new Date().toISOString() },
  predictions: result.predictions,
}, null, 2));
