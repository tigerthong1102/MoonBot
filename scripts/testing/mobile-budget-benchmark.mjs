import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Ledger } from "../../apps/ai-pilot/ledger.mjs";
import { budgetExposure } from "../../apps/ai-pilot/managed-budget.mjs";

const rows = Number(process.argv[2] ?? 3000000);
if (!Number.isSafeInteger(rows) || rows < 1 || rows > 3000000) throw new Error("Choose 1 to 3000000 fixture rows");
const ledger = new Ledger(":memory:");
try {
  const now = Date.now(), day = new Date(now), month = new Date(now);
  day.setUTCHours(0,0,0,0);
  month.setUTCDate(1);
  month.setUTCHours(0,0,0,0);
  ledger.issue("benchmark");
  ledger.db.prepare(`WITH RECURSIVE t(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM t WHERE n<?)
    INSERT INTO requests(id,owner,fingerprint,state,cost,created)
    SELECT cast(n AS TEXT),'benchmark','fixture','settled',1,?-(n%20)*86400000 FROM t`).run(rows,now);
  const fullScan = ledger.db.prepare(`SELECT coalesce(sum(CASE WHEN r.state='held' THEN
    (SELECT sum(held) FROM allocations a WHERE a.owner=r.owner AND a.request=r.id)
    ELSE r.cost END),0) total FROM requests r WHERE r.state='held' OR r.created>=?`);
  const original = [], indexed = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    const daily = fullScan.get(+day).total, monthly = fullScan.get(+month).total;
    const checkpoint = performance.now();
    const actual = budgetExposure(ledger.db,now);
    const end = performance.now();
    assert.deepEqual(actual,{ day:daily, month:monthly, held:0 });
    original.push(Number((checkpoint-start).toFixed(3)));
    indexed.push(Number((end-checkpoint).toFixed(3)));
  }
  console.log(JSON.stringify({ rows, inMemory:true, originalMs:original, dailyTotalsMs:indexed }));
} finally { ledger.db.close(); }
