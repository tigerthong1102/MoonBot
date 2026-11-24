import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { launchVerificationServer } from "./control-omb.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const exec = promisify(execFile);
const fixture = await launchVerificationServer();
const base = fixture.info.url;

async function api(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", origin: base },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
  return value;
}

async function control(...args) {
  const { stdout } = await exec(process.execPath, [
    "--experimental-strip-types", "scripts/control-omb.ts", ...args, "--url", base,
  ], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

try {
  const catalog = JSON.parse(await readFile(new URL("../skills/catalog/index.json", import.meta.url), "utf8"));
  const names = catalog.map(({ name }) => name);
  const listed = (await api("GET", "/api/skills-library")).skills;
  if (listed.length !== names.length || names.some((name) => !listed.some((skill) => skill.name === name))) {
    throw new Error("Fixture library does not match the bundled catalog");
  }
  const bot = (await api("POST", "/api/bots", { name: "Catalog smoke fixture" })).bot;
  for (const name of names) {
    await api("PATCH", `/api/skills-library/${encodeURIComponent(name)}`, { enabled: true });
  }
  await api("PUT", `/api/bots/${encodeURIComponent(bot.id)}/skills-library`, { skills: names });
  const available = (await api("GET", `/api/bots/${encodeURIComponent(bot.id)}/skills`)).skills;
  const unavailable = names.filter((name) => !available.some((skill) => skill.name === name && skill.enabled));
  if (unavailable.length) throw new Error(`Skills unavailable in fixture: ${unavailable.join(", ")}`);

  const failed = [];
  for (const name of names) {
    try {
      await control("send", "--bot", bot.id, "--text", `/${name} Verify fixture routing`);
      const result = await control("wait", "--bot", bot.id, "--timeout", "30");
      const dump = JSON.parse(await readFile(`${fixture.info.dataDir}/fake-claude-dump.json`, "utf8"));
      const prompt = JSON.stringify(dump.prompt);
      if (result.status !== "settled" || !prompt.includes(`The user ran your ${name} skill with /${name}.`) ||
          !prompt.includes(`${name}/SKILL.md`)) {
        throw new Error("turn did not settle or the selected skill was not expanded");
      }
    } catch (error) {
      failed.push({ name, error: String(error) });
    }
  }
  console.log(JSON.stringify({ total: names.length, passed: names.length - failed.length, failed, engine: "fake" }, null, 2));
  if (failed.length) process.exitCode = 1;
} finally {
  await fixture.close();
}
