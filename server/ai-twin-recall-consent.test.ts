import { expect, it, vi } from "vitest";
import type { AiTwinLesson, AiTwinProfile } from "../shared/ai-twin.ts";
import { createAiTwinPreview } from "./ai-twin-preview.ts";

const twin: AiTwinProfile = { id: "twin", name: "Fixture", style: "", paused: false, revision: 1, createdAt: 0, updatedAt: 0 };

function lesson(id: string, question: string, allowed: boolean): AiTwinLesson {
  return { id, question, answer: `Answer ${id}`, source: "owner", updatedAt: 0, ...(allowed ? { allowProvider: true } : {}) };
}

function fixture() {
  const prompts: string[] = [];
  const generateText = vi.fn(async (prompt: string) => { prompts.push(prompt); return prompts.length === 1 ? "0" : "SAME"; });
  const instance = { driverKind: "claudeAgent", instanceId: "fixture", enabled: true, models: { default: "fixture", options: [] }, adapter: { capabilities: { agentsMcp: false } } };
  const preview = createAiTwinPreview({
    selection: () => ({ instanceId: "fixture", model: "fixture" }),
    jobs: { twinPreview: () => ({ name: "Fixture", instance, generateText }) },
  });
  return { preview, prompts, generateText, key: preview.provider(twin.id)!.key };
}

it("does not call a provider when every lesson lacks permission", async () => {
  const { preview, generateText, key } = fixture();
  const result = await preview.recall(twin, "What is the refund policy?", [lesson("private", "How are refunds handled?", false)], key, new AbortController().signal);
  expect(result).toBeNull();
  expect(generateText).not.toHaveBeenCalled();
});

it("never sends unapproved questions or any answers when a caller supplies mixed lessons", async () => {
  const { preview, prompts, key } = fixture();
  const allowed = lesson("public", "How are refunds handled?", true);
  const result = await preview.recall(twin, "What is the refund policy?", [lesson("private", "Private account recovery phrase", false), allowed], key, new AbortController().signal);
  expect(result).toEqual(allowed);
  expect(prompts).toHaveLength(2);
  expect(prompts.join("\n")).toContain(allowed.question);
  expect(prompts.join("\n")).not.toContain("Private account recovery phrase");
  expect(prompts.join("\n")).not.toContain("Answer public");
  expect(prompts.join("\n")).not.toContain("Answer private");
});
