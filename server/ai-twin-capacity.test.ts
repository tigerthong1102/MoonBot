import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createAiTwinPreview } from "./ai-twin-preview.ts";
import { createAiTwinStore } from "./ai-twin.ts";

it("retains exact history and verifies semantic recall past the original 40-lesson limit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "omb-twin-capacity-"));
  try {
    const store = createAiTwinStore(directory, "test-workspace");
    let { view } = store.create({ name: "Twin fixture", createConsent: true, creationEpoch: "initial", creationId: randomUUID() });
    for (let index = 0; index < 80; index += 1) {
      const { id, revision } = view.twin!;
      view = store.saveLesson({
        id, revision, saveAsLesson: true, allowProvider: true,
        question: index === 79 ? "How long are receipts kept?" : `What is the ${String.fromCodePoint(97 + index % 26)}${String.fromCodePoint(97 + Math.floor(index / 26))} policy?`,
        answer: index === 79 ? "Two years." : "Fixture answer.",
      });
    }
    const { id, revision } = view.twin!;
    expect(store.lookupLesson({ id, revision, question: "how long are receipts kept" })).toMatchObject({ answer: "Two years." });
    expect(() => store.saveLesson({ id, revision, saveAsLesson: true, question: "Extra fixture", answer: "No" })).toThrow("twin_lessons_full");
    const instance = {
      driverKind: "claudeAgent", instanceId: "fixture", enabled: true, models: { default: "fixture", options: [] },
      adapter: { capabilities: { agentsMcp: false } },
    };
    const prompts: string[] = [];
    const recall = createAiTwinPreview({
      selection: () => ({ instanceId: "fixture", model: "fixture" }),
      jobs: { twinPreview: () => ({
        name: "Fixture", instance,
        generateText: async (prompt) => { prompts.push(prompt); return prompts.length === 1 ? "79" : "SAME"; },
      }) },
    });
    const lesson = await recall.recall(view.twin!, "What is the receipt retention period?", view.lessons!, recall.provider(id)!.key, new AbortController().signal);
    expect(lesson?.answer).toBe("Two years.");
    expect(prompts).toHaveLength(2);
    expect(prompts.every((prompt) => !prompt.includes("Two years."))).toBe(true);
    expect(createAiTwinStore(directory, "test-workspace").get().lessons).toHaveLength(80);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
