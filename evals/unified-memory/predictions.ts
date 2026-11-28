import { createHash } from "node:crypto";
import type { Prediction } from "./score.ts";

export function corpusSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readPredictions(value: unknown, version: number, digest: string): Prediction[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("prediction file must be an object bound to the corpus version and SHA-256");
  const input = value as Record<string, unknown>;
  if (input.corpusVersion !== version || input.corpusSha256 !== digest) throw new Error("prediction corpus version or SHA-256 mismatch");
  if (!Array.isArray(input.predictions)) throw new Error("prediction file must contain a predictions array");
  return input.predictions as Prediction[];
}
