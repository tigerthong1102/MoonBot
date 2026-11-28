import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { findChrome, launchPipeChrome } from "../../../server/testing/chrome-pipe.ts";
import { normalizeText } from "./personal.mjs";

const { GroupMessage } = createRequire(import.meta.url)("zca-js");
const chrome = findChrome();
if (!chrome) throw new Error("No installed Chrome for the browser fixture");
const account = "1";
const groups = Array.from({ length: 20 }, (_, i) => String(100 + i));
const scope = new Set(groups.map((group) => "group/" + group));
const rows = Array.from({ length: 5000 }, (_, i) => ({
  msgId: String(10_000 + i), uidFrom: "2", idTo: groups[i % groups.length],
  ts: String(1_795_842_000_000 + i), msgType: "webchat", content: "Cần báo giá căn hộ " + (i + 1),
}));
function normalize(rows) {
  return rows.map((data) => normalizeText(account, scope, new GroupMessage(account, data)));
}
const expected = normalize(rows);
assert.equal(expected.filter(Boolean).length, rows.length);
async function measure(run) {
  const samples = [];
  const cpu = process.cpuUsage();
  for (let round = 0; round < 21; round++) {
    const start = performance.now();
    const result = await run();
    const elapsed = performance.now() - start;
    if (round) samples.push(elapsed);
    assert.deepEqual(result, expected);
  }
  const usage = process.cpuUsage(cpu);
  samples.sort((a, b) => a - b);
  return {
    rowsPerBatch: rows.length, measuredBatches: samples.length,
    batchMsP50: +samples[9].toFixed(2), batchMsP95: +samples[18].toFixed(2),
    parentCpuMsIncludingAssertionsAndWarmup: Math.round((usage.user + usage.system) / 1000),
  };
}

const sdk = await measure(() => normalize(rows));
const started = performance.now();
const browser = await launchPipeChrome(chrome, []);
try {
  const page = await browser.page();
  const startupMs = Math.round(performance.now() - started);
  const html = rows.map((row) => '<p data-id="' + row.msgId + '" data-from="' + row.uidFrom +
    '" data-to="' + row.idTo + '" data-ts="' + row.ts + '">' + row.content + '</p>').join("");
  await page.evaluate("document.body.innerHTML = " + JSON.stringify(html) + "; true");
  const version = await page.evaluate("navigator.userAgent");
  const dom = await measure(async () => {
    const extracted = await page.evaluate(`Array.from(document.querySelectorAll("p[data-id]"), (p) => ({
      msgId: p.dataset.id, uidFrom: p.dataset.from, idTo: p.dataset.to, ts: p.dataset.ts,
      msgType: "webchat", content: p.textContent
    }))`);
    return normalize(extracted);
  });
  console.log(JSON.stringify({
    scenario: "synthetic, message construction vs preloaded DOM extraction plus identical normalization",
    node: process.version, platform: process.platform + "/" + process.arch, chrome: version,
    sdk, dom, browserStartupMs: startupMs,
    parentPeakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
  }, null, 2));
} finally {
  await browser.close();
}
