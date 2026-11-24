import assert from "node:assert/strict";

const configured = process.env.STARTUPBOT_INBOX_ORIGIN;
const origin = new URL(configured);
assert.equal(origin.protocol, "https:");
assert.equal(origin.origin, configured);
const response = await fetch(origin, { redirect: "error", signal: AbortSignal.timeout(15000) });
assert(response.ok, "The pilot server did not respond");
assert.match(await response.text(), /id="record-voice"/);
