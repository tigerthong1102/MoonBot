import { readFileSync } from "node:fs";
import { score, type MemoryCase, type Prediction } from "./score.ts";

const args = process.argv.slice(2);
const contextual = args[0] === "--context";
if (contextual) args.shift();
if (args.length > 1) throw new Error("expected at most one prediction file");
const corpus = JSON.parse(readFileSync(new URL(contextual ? "./context-cases.json" : "./cases.json", import.meta.url), "utf8")) as { version: number; cases: MemoryCase[] };
const predictionPath = args[0];
const predictions: Prediction[] = predictionPath ? JSON.parse(readFileSync(predictionPath, "utf8")) : [];
if (!Array.isArray(predictions)) throw new Error("prediction file must contain an array");
console.log(JSON.stringify({ corpus: contextual ? "context" : "question-only", corpusVersion: corpus.version, ...score(corpus.cases, predictions) }, null, 2));
