import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareAdvance, submitDemoAdvance } from "./advance.mjs";

const sample = {
  company: "DEMO", branch: "00000000-1111-4444-aaaa-000000000001",
  employee: "00000000-1111-4444-aaaa-000000000002",
  reference: "00000000-1111-4444-aaaa-000000000003", number: "00017",
  date: "2026-11-18", amountVnd: "1000000", debit: "141", credit: "1111",
};
const config = { company: sample.company, branch: sample.branch, clientId: "fixture", accessCode: "fixture-code" };

test("employee advance preserves identity and integer VND", () => {
  const [voucher] = prepareAdvance(sample).voucher;
  assert.equal(voucher.org_refno, "00017");
  assert.deepEqual([voucher.voucher_type, voucher.reftype, voucher.reason_type_id], [4, 1020, 21]);
  assert.equal(voucher.total_amount, voucher.detail[0].amount);
  assert.equal(voucher.detail[0].account_object_id, sample.employee);
  assert.equal(voucher.detail[0].credit_account, "1111");
  assert.equal(voucher.detail[0].debit_account, "141");
  for (const bad of [{ amountVnd: "9007199254740993" }, { amountVnd: "-1" }, { amountVnd: "100.25" },
    { date: "2026-02-29" }, { debit: "131" }, { credit: "1121" }, { branch: "" }]) {
    assert.throws(() => prepareAdvance({ ...sample, ...bad }));
  }
});

async function fixture(t, save) {
  const dir = await mkdtemp(join(tmpdir(), "asp-pilot-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const fake = async (url, opts) => {
    calls.push(url);
    assert.equal(opts.method, "POST");
    assert.equal(opts.redirect, "error");
    assert.equal(opts.headers.ClientID, config.clientId);
    if (url === "https://developer.misa.vn/apis/asp/v1/token") {
      assert.deepEqual(JSON.parse(opts.body), { org_company_code: "DEMO", access_code: "fixture-code" });
      return Response.json({ Success: true, Data: { access_token: "fixture-token" } });
    }
    assert.equal(url, "https://developer.misa.vn/apis/asp/v1/save");
    assert.equal(opts.headers["X-MISA-AccessToken"], "fixture-token");
    assert.deepEqual(JSON.parse(opts.body), prepareAdvance(sample));
    return save();
  };
  return { dir, calls, run: (input = sample, cfg = config) => submitDemoAdvance(input, cfg, dir, fake) };
}

test("bound scope, concurrent save, replay and conflicting amount", async t => {
  const f = await fixture(t, () => Response.json({ Success: true }));
  await assert.rejects(f.run(sample, { ...config, branch: sample.employee }), /scope_mismatch/);
  await assert.rejects(f.run(sample, { ...config, company: "B" }), /scope_mismatch/);
  assert.equal(f.calls.length, 0);
  const pair = await Promise.all([f.run(), f.run()]);
  assert.ok(pair.some(r => r.status === "queued"));
  assert.equal((await f.run()).status, "already_queued");
  await assert.rejects(f.run({ ...sample, amountVnd: "2000000" }), /reference_conflict/);
  assert.equal(f.calls.filter(s => s.endsWith("/save")).length, 1);
  const files = await readdir(f.dir);
  assert.equal(files.length, 1);
  assert.match(await readFile(join(f.dir, files[0]), "utf8"), /^[0-9a-f]{64}\nqueued$/);
});

test("ambiguous remote result suppresses replay", async t => {
  const f = await fixture(t, () => { throw new Error("lost response"); });
  await assert.rejects(f.run(), /lost response/);
  assert.equal((await f.run()).status, "needs_reconciliation");
  assert.equal(f.calls.filter(s => s.endsWith("/save")).length, 1);
});

test("HTTP 200 with vendor error is not authentication", async t => {
  const f = await fixture(t);
  let count = 0;
  await assert.rejects(submitDemoAdvance(sample, config, f.dir, async () => {
    count++;
    return Response.json({ Success: false, ErrorCode: "DBAmisNotConnectDBACT" });
  }), /DBAmisNotConnectDBACT/);
  assert.equal(count, 1);
  assert.deepEqual(await readdir(f.dir), []);
});
