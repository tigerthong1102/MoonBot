import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createAiTwinStore, saveTwinLessonInput } from "../../server/ai-twin.ts";

const corpus = readFileSync(new URL("../../third_party/agenticos-memory-evals/memory.tsv", import.meta.url), "utf8");
const scenarios = corpus.trimEnd().split(/\r?\n/).slice(1).map((line) => {
  const [id, , , statement, prior, operation] = line.split("|");
  if (!id || !statement || !prior || !operation || !["add", "update", "none"].includes(operation)) {
    throw new Error("Unexpected AgenticOS memory fixture row");
  }
  return { id, statement, prior, operation };
});

// The upstream labels describe automatic classification. These checks exercise
// StartupBot's explicit owner writes and storage lifecycle on the same text.
it.each(scenarios)("$id applies the explicit owner memory policy", ({ id, statement, prior, operation }) => {
  const root = mkdtempSync(join(tmpdir(), "omb-twin-eval-"));
  try {
    const store = createAiTwinStore(root, "fixture-workspace");
    const twin = store.create({
      name: "Fixture Twin", creationEpoch: "initial", creationId: randomUUID(), createConsent: true,
    }).view.twin!;
    const sourceQuestion = `What is the current example for ${id}?`;
    const version = { id: twin.id, revision: twin.revision };
    expect(store.lookupLesson({ ...version, question: statement })).toBeNull();
    expect(saveTwinLessonInput.safeParse({ ...version, question: sourceQuestion, answer: statement }).success).toBe(false);
    if (operation === "none") {
      expect(store.get().lessons).toEqual([]);
      return;
    }

    const original = store.saveLesson({
      ...version, question: sourceQuestion, answer: operation === "update" ? prior : statement, saveAsLesson: true,
    });
    const before = original.lessons![0]!;
    const state = operation === "update" ? store.saveLesson({
      id: twin.id, revision: original.twin!.revision, lessonId: before.id,
      question: sourceQuestion, answer: statement, saveAsLesson: true,
    }) : original;
    const reopened = createAiTwinStore(root, "fixture-workspace");
    const current = { id: twin.id, revision: state.twin!.revision };
    const known = reopened.lookupLesson({ ...current, question: sourceQuestion.toUpperCase().slice(0, -1) });
    expect(known).toMatchObject({ id: before.id, answer: statement.trim(), source: "owner" });
    const forgotten = reopened.forgetLesson({ ...current, lessonId: before.id });
    expect(reopened.lookupLesson({ id: twin.id, revision: forgotten.twin!.revision, question: sourceQuestion })).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
