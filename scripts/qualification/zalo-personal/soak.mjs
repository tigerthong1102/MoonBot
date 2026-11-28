import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { createZaloInbox } from "../../../server/zalo-inbox.ts";
import { normalizeText } from "./personal.mjs";

const mode = process.argv[2];
if (!["--smoke", "--eight-hours"].includes(mode) || process.argv.length !== 3) throw new Error("Choose --smoke or --eight-hours");
const { GroupMessage } = createRequire(import.meta.url)("zca-js");
const dir = await mkdtemp(join(tmpdir(), "zalo-synthetic-soak-"));
const file = join(dir, "inbox.sqlite");
let db = new DatabaseSync(file);
let inbox = createZaloInbox(db);
const accounts = ["101", "102"], senderId = "7";
const groups = Array.from({ length: 20 }, (_, i) => String(1000 + i));
const scope = new Set(groups.map(id => "group/" + id));
const grants = accounts.flatMap(accountId => groups.map(conversationId => inbox.enroll({
  adapter: "personal", accountId, senderId, conversationId, conversationType: "group", retentionDays: 1,
})));
const smoke = mode === "--smoke";
const period = smoke ? 500 : 60_000;
const rounds = smoke ? 3 : 481;
const started = Date.now(), cpuStart = process.cpuUsage();
let previous = started, gaps = 0, stored = 0, duplicates = 0, restarts = 0, peakRss = 0, rssSum = 0;
const writeTimes = [];
try {
  for (let round = 0; round < rounds; round++) {
    if (round) await delay(Math.max(0, previous + period - Date.now()));
    const tick = Date.now();
    if (tick - previous > period * 2.5) gaps++;
    previous = tick;
    if (round && (round % 10 === 0 || smoke)) {
      db.close();
      db = new DatabaseSync(file);
      inbox = createZaloInbox(db);
      restarts++;
    }
    for (const [i, grant] of grants.entries()) {
      const conversation = groups[i % groups.length], account = accounts[Math.floor(i / groups.length)];
      const row = { msgId: String(100000 + round), uidFrom: senderId, idTo: conversation, ts: String(tick), msgType: "webchat", content: "Tin kiểm thử tổng hợp" };
      const event = normalizeText(account, scope, new GroupMessage(account, row));
      assert.ok(event);
      const at = performance.now();
      assert.equal(inbox.accept(event, grant), "persisted");
      writeTimes.push(performance.now() - at);
      stored++;
      assert.equal(inbox.accept(event, grant), "duplicate");
      duplicates++;
      assert.equal(inbox.coverage(grant).count, round + 1);
    }
    const rss = process.memoryUsage().rss;
    rssSum += rss;
    peakRss = Math.max(peakRss, rss);
    if (round % 10 === 0 || round + 1 === rounds)
      console.log(JSON.stringify({ phase: "checkpoint", started, round: round + 1, stored, duplicates, restarts, gaps, rss }));
  }
  writeTimes.sort((a,b) => a-b);
  const cpu = process.cpuUsage(cpuStart);
  const totalRead = grants.reduce((n, grant) => n + inbox.coverage(grant).count, 0);
  assert.equal(totalRead, stored);
  console.log(JSON.stringify({ phase: "complete", mode, elapsedMs: Date.now()-started, gaps, stored, duplicates, restarts,
    expectedUnique: grants.length * rounds, totalRead, missingFixtureEvents: grants.length * rounds - totalRead,
    avgRssBytes: Math.round(rssSum/rounds), peakRssBytes: peakRss, cpuMs: (cpu.user+cpu.system)/1000,
    diskBytes: (await stat(file)).size, sqliteWriteP50Ms: writeTimes[Math.floor(writeTimes.length*.5)],
    sqliteWriteP95Ms: writeTimes[Math.floor(writeTimes.length*.95)], tokenCost: 0 }));
  // CI smoke verifies write/replay/reopen integrity. Only the long run qualifies continuous operation.
  if (!smoke && gaps) process.exitCode = 2;
} finally { db.close(); await rm(dir,{ recursive: true, force: true }); }
