import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("rejects media domains resolving to private addresses and redirects to loopback", () => {
  const moduleUrl = pathToFileURL(resolve("skills/catalog/media-use/scripts/lib/media-fetch.mjs")).href;
  const script = `
    import assert from 'node:assert/strict';
    import dns from 'node:dns';
    import { fetchMedia } from ${JSON.stringify(moduleUrl)};
    for (const address of ['127.0.0.1', '10.20.30.40', '169.254.169.254', '::1']) {
      dns.lookup = (_name, _options, callback) => queueMicrotask(() => callback(null, [{ address, family: address.includes(':') ? 6 : 4 }]));
      await assert.rejects(fetchMedia('http://public.example/resource'), /non-public address/);
    }
    let calls = 0;
    await assert.rejects(fetchMedia('https://public.example/a', { fetchImpl: async () => {
      calls++; return new Response(null, {status: 302, headers: {location: 'http://127.0.0.1/private'}});
    } }), /URL is not public/);
    assert.equal(calls, 1);
    console.log('private DNS and redirect refused');
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000 });
  expect(output).toContain("private DNS and redirect refused");
});

it("sends no media telemetry without an explicit opt-in", () => {
  const home = mkdtempSync(join(tmpdir(), "startupbot-media-telemetry-"));
  try {
    const moduleUrl = pathToFileURL(resolve("skills/catalog/media-use/scripts/lib/telemetry.mjs")).href;
    const script = `
      import assert from 'node:assert/strict';
      import { track, optedOut } from ${JSON.stringify(moduleUrl)};
      let requests = 0;
      globalThis.fetch = async () => { requests++; throw new Error('unexpected network'); };
      assert.equal(optedOut(), true);
      await track('synthetic-test');
      assert.equal(requests, 0);
    `;
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, NODE_ENV: "production" },
      timeout: 10_000,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
