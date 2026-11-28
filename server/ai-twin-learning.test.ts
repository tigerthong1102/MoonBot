import { expect, it } from "vitest";
import { twinLearningText, twinLearningView, type TwinLearningRow } from "./ai-twin-learning.ts";

const sample = (message: string, text: string, ts: number, thread = "private"): TwinLearningRow => ({ thread, message, text, ts });

it("surfaces established question and answer pairs across the granted history", () => {
  const history = Array.from({ length: 200 }, (_, index) => sample("message-" + index, "Writing style observed in a newer owner message.", index + 10));
  const question = sample("question", "Ai duyệt yêu cầu xuất hàng?", 2);
  const reply = { ...sample("reply", "Trưởng bộ phận kho duyệt yêu cầu xuất hàng.", 3), replyToId: question.message };
  const correction = sample("correction", "Câu hỏi： AI DUYỆT YÊU CẦU XUẤT HÀNG?\nTrả lời： Quản lý ca duyệt yêu cầu xuất hàng.", 4);
  const otherQuestion = sample("other-question", "When does warehouse inventory start?", 5);
  const otherReply = { ...sample("other-reply", "It starts at nine in the morning.", 6), replyToId: otherQuestion.message };
  const unpaired = { ...sample("unpaired", "Only the payroll team can approve it.", 7, "elsewhere"), replyToId: question.message };
  const view = twinLearningView([], [], [...history, question, reply, correction, otherQuestion, otherReply, unpaired]);
  expect(view.examples.slice(0, 2)).toEqual([
    { thread: "private", message: "other-reply", question: otherQuestion.text, text: otherReply.text },
    { thread: "private", message: "correction", question: "AI DUYỆT YÊU CẦU XUẤT HÀNG?", text: "Quản lý ca duyệt yêu cầu xuất hàng." },
  ]);
  expect(view.examples).not.toContainEqual(expect.objectContaining({ message: "reply" }));
  expect(view.examples).not.toContainEqual(expect.objectContaining({ message: "unpaired", question: expect.any(String) }));
  expect(view.examples).toHaveLength(12);
  expect(view.style?.samples).toBe(120);
});

it("filters automated messages, provider text, attachments and recognized secrets before extraction", () => {
  const message = { id: "m", at: 0, role: "user", kind: "text", text: "Use this approved synthetic answer." } as const;
  expect(twinLearningText(message)).toBe(message.text);
  expect(twinLearningText({ ...message, role: "bot" })).toBeUndefined();
  expect(twinLearningText({ ...message, automated: true })).toBeUndefined();
  expect(twinLearningText({ ...message, relayed: true })).toBeUndefined();
  expect(twinLearningText({ ...message, workBotReviewHold: true })).toBeUndefined();
  const parent = { ...message, id: "question", text: "Who reviews the inventory?" };
  const reply = { ...message, replyToId: parent.id };
  expect(twinLearningText(reply, parent)).toBe(message.text);
  expect(twinLearningText(reply)).toBeUndefined();
  expect(twinLearningText(reply, { ...parent, workBotReviewHold: true })).toBeUndefined();
  expect(twinLearningText({ ...message, workBotRouting: { state: "held_for_review" } })).toBeUndefined();
  expect(twinLearningText({ ...message, text: "Contact fixture@example.test to see the memo." })).toBeUndefined();
  expect(twinLearningText({ ...message, text: "Please call 090 000 0000 to continue." })).toBeUndefined();
});
