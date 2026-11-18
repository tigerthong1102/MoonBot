import assert from "node:assert/strict";

export function simulatedEntitlementsFromDump(dump) {
  const words = [];
  for (const line of dump.split("\n")) {
    const [address, ...fields] = line.trim().split(/\s+/);
    if (!/^[0-9a-f]{8,16}$/i.test(address ?? "")) continue;
    assert(fields.length && fields.every(field => /^(?:[0-9a-f]{2}){1,4}$/i.test(field)), "Malformed otool section data");
    words.push(...fields.map(field => Buffer.from(field, "hex").reverse()));
  }
  return Buffer.concat(words).toString("utf8").replace(/\0+$/, "");
}
