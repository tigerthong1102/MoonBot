import { readFileSync } from "node:fs";
import { score, type MemoryCase, type Prediction } from "./score.ts";

const corpus = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8")) as { version: number; cases: MemoryCase[] };
const predictionPath = process.argv[2];
const predictions: Prediction[] = predictionPath ? JSON.parse(readFileSync(predictionPath, "utf8")) : [];
if (!Array.isArray(predictions)) throw new Error("prediction file must contain an array");
console.log(JSON.stringify({ corpusVersion: corpus.version, ...score(corpus.cases, predictions) }, null, 2));
