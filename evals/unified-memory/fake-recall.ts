import { createAiTwinPreview } from "../../server/ai-twin-preview.ts";
import type { AiTwinLesson, AiTwinProfile } from "../../shared/ai-twin.ts";
import type { MemoryCase, Prediction } from "./score.ts";

export type FakeMode = "same" | "none" | "error";

export async function fakeRecall(cases: readonly MemoryCase[], mode: FakeMode): Promise<{ predictions: Prediction[]; calls: number }> {
  let calls = 0;
  const twin: AiTwinProfile = { id: "fixture-twin", name: "Synthetic fixture", style: "", paused: false, revision: 1, createdAt: 0, updatedAt: 0 };
  const instance = {
    driverKind: "claudeAgent", instanceId: "fixture", enabled: true, models: { default: "deterministic-fake", options: [] },
    adapter: { capabilities: { agentsMcp: false } },
  };
  const recall = createAiTwinPreview({
    selection: () => ({ instanceId: "fixture", model: "deterministic-fake" }),
    jobs: { twinPreview: () => ({ name: "Deterministic fake", instance, generateText: async (prompt) => {
      calls += 1;
      if (mode === "error") throw new Error("synthetic provider failure");
      if (prompt.startsWith("Find a saved FAQ question")) return mode === "same" ? "0" : "NONE";
      if (prompt.startsWith("Verify this possible FAQ match")) return "SAME";
      throw new Error("unexpected synthetic prompt");
    } }) },
  });
  const key = recall.provider(twin.id)?.key;
  if (!key) throw new Error("fixture provider unavailable");
  const predictions: Prediction[] = [];
  for (const item of cases) {
    const lesson: AiTwinLesson = { id: item.id, question: item.saved, answer: "Synthetic answer not provided to provider.", source: "owner", allowProvider: true, updatedAt: 0 };
    try {
      const match = await recall.recall(twin, item.query, [lesson], key, new AbortController().signal);
      predictions.push({ id: item.id, result: match ? "match" : "none" });
    } catch {
      predictions.push({ id: item.id, result: "error" });
    }
  }
  return { predictions, calls };
}
