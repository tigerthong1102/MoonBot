import { readFileSync } from "node:fs";
import { corpusSha256, readPredictions } from "./predictions.ts";
import { score, type MemoryCase } from "./score.ts";

const args = process.argv.slice(2);
const contextual = args[0] === "--context";
if (contextual) args.shift();
if (args.length > 1) throw new Error("expected at most one prediction file");
const bytes = readFileSync(new URL(contextual ? "./context-cases.json" : "./cases.json", import.meta.url));
const corpus = JSON.parse(bytes.toString("utf8")) as { version: number; cases: MemoryCase[] };
const digest = corpusSha256(bytes);
const predictionPath = args[0];
const predictions = predictionPath ? readPredictions(JSON.parse(readFileSync(predictionPath, "utf8")), corpus.version, digest) : [];
console.log(JSON.stringify({ corpus: contextual ? "context" : "question-only", corpusVersion: corpus.version, corpusSha256: digest, ...score(corpus.cases, predictions) }, null, 2));
