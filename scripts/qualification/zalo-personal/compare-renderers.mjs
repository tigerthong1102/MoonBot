import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { launchPipeChrome } from "../../../server/testing/chrome-pipe.ts";
import { normalizeText } from "./personal.mjs";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const chrome = process.env.ZALO_BENCH_CHROME;
const agent = process.env.ZALO_BENCH_AGENT_BROWSER;
const playwright = process.env.ZALO_BENCH_PLAYWRIGHT;
if (!chrome || !agent || !playwright) throw new Error("Provide the three existing local binaries/module paths described in the verification guide.");
// Do not let any driver inherit agent-browser settings, CDP endpoints, proxies or login state.
const root = await mkdtemp(join(process.platform === "win32" ? tmpdir() : "/tmp", "zalo-bench-"));
const sandbox = {
  HOME: root, USERPROFILE: root, APPDATA: join(root, "app"), LOCALAPPDATA: join(root, "local"),
  XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"),
  XDG_RUNTIME_DIR: join(root, "run"), AGENT_BROWSER_SOCKET_DIR: join(root, "sockets"),
  TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
};
for (const dir of new Set(Object.values(sandbox))) await mkdir(dir, { recursive: true, mode: 0o700 });
const config = join(root, "empty-config.json");
await writeFile(config, "{}\n", { mode: 0o600 });
const windows = {};
if (process.platform === "win32") {
  for (const name of ["SystemRoot", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "PATHEXT"]) {
    if (process.env[name]) windows[name] = process.env[name];
  }
}
process.env = { ...sandbox, ...windows, LANG: "en_US.UTF-8", AGENT_BROWSER_CONFIG: config,
  PATH: process.platform === "win32" ? join(windows.SystemRoot || "C:\\Windows", "System32") : "/usr/bin:/bin" };
const { chromium } = require(resolve(playwright));
const { GroupMessage } = require("zca-js");
const session = "zalo-fixture-" + randomUUID().slice(0, 12);
const scope = new Set(Array.from({ length: 20 }, (_, i) => "group/" + (100+i)));
const normalize = rows => rows.map(row => normalizeText("1", scope, new GroupMessage("1",row)));
const sizes = [100, 1_000, 5_000, 10_000];
function input(n) {
  return Array.from({length:n}, (_, i) => ({msgId:String(i+1),uidFrom:"2",idTo:String(100+i%20),
    ts:String(1795842000000+i),msgType:"webchat",content:"Tin kiểm thử "+i}));
}
const render = n => `(() => {document.body.replaceChildren(); const f=document.createDocumentFragment(); for(let i=0;i<${n};i++){const p=document.createElement('p');p.dataset.i=String(i);p.textContent='Tin kiểm thử '+i;f.append(p);}document.body.append(f);return true;})()`;
const extract = `Array.from(document.querySelectorAll('p[data-i]'),p=>{const i=Number(p.dataset.i);return {msgId:String(i+1),uidFrom:'2',idTo:String(100+i%20),ts:String(1795842000000+i),msgType:'webchat',content:p.textContent}})`;
async function measure(driver, evaluate) {
  for (const n of sizes) {
    const rows = input(n);
    const expected = normalize(rows);
    assert.equal(expected.filter(Boolean).length,n);
    if (evaluate) await evaluate(render(n));
    const times = [];
    for (let round = 0; round <= 20; round++) {
      const start = performance.now();
      const actual = normalize(evaluate ? await evaluate(extract) : rows);
      const elapsed = performance.now()-start;
      assert.deepEqual(actual,expected);
      if (round) times.push(elapsed);
    }
    times.sort((a,b) => a-b);
    console.log(JSON.stringify({driver,events:n,groups:20,rounds:times.length,msP50:times[9],msP95:times[18]}));
  }
}
async function cli(...args) {
  const { stdout } = await run(agent,["--session",session,"--executable-path",chrome,"--json",...args],{cwd:root,env:process.env,timeout:40_000,maxBuffer:12*1024*1024});
  const result = JSON.parse(stdout);
  if (!result.success) throw new Error("Agent Browser fixture command failed");
  return result.data;
}
try {
  await measure("zca-js constructors",null);
  let start=performance.now();
  const pipe=await launchPipeChrome(chrome,[]);
  try {
    const page=await pipe.page();
    console.log(JSON.stringify({driver:"StartupBot CDP",coldMs:performance.now()-start}));
    await measure("StartupBot CDP",expression=>page.evaluate(expression));
  } finally { await pipe.close(); }
  start=performance.now();
  const browser=await chromium.launch({executablePath:chrome,headless:true});
  try {
    const page=await browser.newPage();
    console.log(JSON.stringify({driver:"Playwright",coldMs:performance.now()-start}));
    await measure("Playwright",expression=>page.evaluate(expression));
  } finally { await browser.close(); }
  start=performance.now();
  try {
    await cli("open","about:blank");
    console.log(JSON.stringify({driver:"bundled Agent Browser CLI",coldMs:performance.now()-start}));
    await measure("bundled Agent Browser CLI",async expression=>(await cli("eval",expression)).result);
  } finally { await cli("close"); }
} finally {
  await rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 250});
}
