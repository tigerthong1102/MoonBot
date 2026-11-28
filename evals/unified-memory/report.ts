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
const envelope: unknown = predictionPath ? JSON.parse(readFileSync(predictionPath, "utf8")) : undefined;
const predictions = predictionPath ? readPredictions(envelope, corpus.version, digest) : [];
const metadata = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? (envelope as Record<string, unknown>).metadata : undefined;
const declaredFake = Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata) && (metadata as Record<string, unknown>).kind === "deterministic-fake");
const provenance = !predictionPath ? "NOT_RUN" : declaredFake ? "DECLARED_SYNTHETIC_FAKE_NOT_MODEL" : "UNVERIFIED";
console.log(JSON.stringify({ corpus: contextual ? "context" : "question-only", corpusVersion: corpus.version, corpusSha256: digest, provenance, ...score(corpus.cases, predictions) }, null, 2));
