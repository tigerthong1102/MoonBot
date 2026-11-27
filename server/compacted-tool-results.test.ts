import { describe, expect, it } from "vitest";
import { summaryWithToolReferences, readCompactedToolOutput, toolRecallEnabled } from "./compacted-tool-results.ts";
import { type Message } from "./store.ts";

const call: Message = { id: "invoice", at: 1, role: "bot", kind: "activity", tool: { name: "Read", itemId: "native", output: "HĐ 4021 = 19.540.000 VND", ok: true } };
const answer: Message = { id: "answer", at: 2, role: "bot", kind: "text", text: "done" };

describe("compacted tool references", () => {
  it("recovers the recorded amount after two folds without sending it in the summary", () => {
    const path = [call, answer];
    const first = summaryWithToolReferences("first", "accounting", path, answer.id);
    expect(first).toContain('"invoice" [ran: Read');
    const next = { ...answer, id: "next" };
    const second = summaryWithToolReferences("second", "accounting", [...path, next], next.id);
    expect(second).toContain('"invoice" [ran: Read');
    expect(second).not.toContain("19.540.000");
    expect(readCompactedToolOutput("accounting", "invoice", path)?.text).toContain("HĐ 4021 = 19.540.000 VND");
  });
  it("drops references from abandoned, deleted, setup and not-yet-folded activity", () => {
    const sibling = { ...call, id: "other" };
    expect(readCompactedToolOutput("accounting", "invoice", [sibling, answer])).toBeNull();
    expect(readCompactedToolOutput("accounting", "invoice", [])).toBeNull();
    expect(readCompactedToolOutput("accounting", "invoice", [{ ...call, tool: { ...call.tool!, setup: true } }])).toBeNull();
    expect(summaryWithToolReferences("summary", "accounting", [answer, call], answer.id)).toBe("summary");
    expect(toolRecallEnabled({ replayToolHistory: true }, false)).toBe(false);
  });
});
