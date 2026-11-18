import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = "https://developer.misa.vn/apis/asp/v1/";
const guid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function check(ok, message) {
  if (!ok) throw new Error(message);
}

function identifier(value, pattern, field) {
  check(typeof value === "string" && value.length <= 128 && pattern.test(value), field);
  return value;
}

export function prepareAdvance(input) {
  const company = identifier(input.company, /^[A-Za-z0-9._-]+$/, "invalid_company");
  const branch = identifier(input.branch, guid, "invalid_branch").toLowerCase();
  const employee = identifier(input.employee, guid, "invalid_employee").toLowerCase();
  const reference = identifier(input.reference, guid, "invalid_reference").toLowerCase();
  const number = identifier(input.number, /^[^\p{C}\s][^\p{C}]{0,49}$/u, "invalid_number");
  const date = identifier(input.date, /^\d{4}-\d{2}-\d{2}$/, "invalid_date");
  const parsed = new Date(date);
  check(Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date, "invalid_date");
  const amount = input.amountVnd;
  check(typeof amount === "string" && /^[1-9]\d{0,15}$/.test(amount) &&
    Number.isSafeInteger(Number(amount)), "invalid_vnd");
  const debit = identifier(input.debit, /^141\d*$/, "invalid_advance_account");
  const credit = identifier(input.credit, /^111\d*$/, "invalid_cash_account");
  const money = Number(amount);
  return {
    org_company_code: company,
    voucher: [{
      voucher_type: 4, reftype: 1020, reason_type_id: 21,
      org_refid: reference, org_refno: number, branch_id: branch,
      refdate: date, posted_date: date, account_object_id: employee,
      currency_id: "VND", exchange_rate: 1, total_amount_oc: money, total_amount: money,
      detail: [{ sort_order: 1, debit_account: debit, credit_account: credit,
        account_object_id: employee, amount_oc: money, amount: money }],
    }],
  };
}

async function post(method, headers, body, fetchImpl) {
  const response = await fetchImpl(base + method, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  check(response.ok, "http_" + response.status);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    check(size <= 65536, "response_too_large");
    chunks.push(chunk);
  }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (result?.Success !== true) {
    const known = ["InvalidAppID", "InvalidAccessToken", "ExpiredToken", "InvalidToken",
      "DBAmisNotConnectDBACT", "AppIDDisconnect", "IsCreatedVoucher", "InvalidParam"];
    throw new Error(known.includes(result?.ErrorCode) ? result.ErrorCode : "request_rejected");
  }
  return result.Data;
}

const hash = value => createHash("sha256").update(value).digest("hex");

export async function submitDemoAdvance(input, config, directory, fetchImpl = fetch) {
  const body = prepareAdvance(input);
  const voucher = body.voucher[0];
  check(body.org_company_code === config.company && voucher.branch_id === config.branch?.toLowerCase(),
    "demo_scope_mismatch");
  check(config.clientId && config.accessCode, "missing_connection");
  const tokenData = await post("token", { ClientID: config.clientId }, {
    access_code: config.accessCode, org_company_code: config.company,
  }, fetchImpl);
  const token = (typeof tokenData === "string" ? JSON.parse(tokenData) : tokenData)?.access_token;
  check(typeof token === "string" && token.trim().length > 0, "invalid_token_response");

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, hash(JSON.stringify([config.company, voucher.org_refid])));
  const digest = hash(JSON.stringify(body));
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const existing = await readFile(path, "utf8");
    if (!existing) return { status: "needs_reconciliation" };
    const [savedDigest, state] = existing.split("\n");
    check(savedDigest === digest, "reference_conflict");
    return { status: state === "queued" ? "already_queued" : "needs_reconciliation" };
  }
  try {
    await handle.writeFile(digest + "\npending");
    await handle.sync();
  } finally {
    await handle.close();
  }
  // An interrupted save can already be in the vendor queue. Keep the reservation for reconciliation.
  await post("save", { ClientID: config.clientId, "X-MISA-AccessToken": token }, body, fetchImpl);
  await writeFile(path + ".tmp", digest + "\nqueued", { mode: 0o600 });
  await rename(path + ".tmp", path);
  return { status: "queued" };
}
