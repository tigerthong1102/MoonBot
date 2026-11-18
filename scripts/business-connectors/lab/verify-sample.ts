import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessEngine } from "../compatibility.ts";

const sample = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(0)));
assert.match(sample.edition, /Express/i);
assert.equal(assessEngine(sample).next, "verify-driver-channel-and-grant");
assert.equal(sample.amount, "-12345678901234567890.1200");
assert.equal(sample.description, "Đắk Lắk");
assert.equal(sample.code, "0000123456");
