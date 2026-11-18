import { homedir } from "node:os";
import { join } from "node:path";
import { prepareAdvance, submitDemoAdvance } from "./advance.mjs";

try {
  const command = process.argv[2];
  if (!["prepare", "submit-demo"].includes(command)) throw new Error("invalid_command");
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16384) throw new Error("input_too_large");
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const env = process.env;
  const result = command === "prepare" ? prepareAdvance(input) : await submitDemoAdvance(input, {
    company: env.ASP_DEMO_COMPANY, branch: env.ASP_DEMO_BRANCH,
    clientId: env.ASP_CLIENT_ID, accessCode: env.ASP_ACCESS_CODE,
  }, join(homedir(), ".startupbot", "asp-pilot"));
  console.log(JSON.stringify(result));
} catch (err) {
  const message = String(err.message);
  const safe = /^(?:invalid_[a-z_]+|http_[0-9]{3}|demo_scope_mismatch|missing_connection|reference_conflict|response_too_large|input_too_large|request_rejected|InvalidAppID|InvalidAccessToken|ExpiredToken|InvalidToken|DBAmisNotConnectDBACT|AppIDDisconnect|IsCreatedVoucher|InvalidParam)$/;
  console.error(JSON.stringify({ error: safe.test(message) ? message : "check_input_or_reconcile" }));
  process.exitCode = 1;
}
