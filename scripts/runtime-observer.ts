import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readLifecyclePage } from "../server/runtime/observer.ts";
import { publishFile } from "../server/dev-workspace/command.ts";

const { values } = parseArgs({ options: {
  database: { type: "string" }, key: { type: "string" },
  after: { type: "string", default: "0" }, limit: { type: "string", default: "200" },
} });
if (!values.database || !existsSync(values.database)) throw new Error("Specify an existing runtime.db with --database.");
const keyPath = resolve(values.key ?? values.database + ".observer-key");
if (!existsSync(keyPath)) publishFile(keyPath, randomBytes(32).toString("hex"));
const key = readFileSync(keyPath, "utf8").trim();
if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("The observer key must contain a 32-byte hex key.");
const page = readLifecyclePage(values.database, Buffer.from(key, "hex"), Number(values.after), Number(values.limit));
process.stdout.write(JSON.stringify(page) + "\n");
