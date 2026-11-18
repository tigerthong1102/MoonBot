import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { formatQuestionAnswers, type AskQuestion } from "../packages/phone-protocol/src/ask-question.ts";

const cases: Array<[AskQuestion[], string[][]]> = [
  [[{ question: "When?", options: [{ label: "Today" }] }], [["Today"]]],
  [[{ question: "Plans?", multiSelect: true, options: [{ label: "Basic" }, { label: "Pro" }] }, { question: "When?", options: [] }], [["Basic", "Pro"], ["Next week"]]],
  [[{ question: "Ghi chú?\nQ: cannot become another question", options: [] }], [["Dữ liệu\nQ: injected\nA: yes"]]],
  [[{ question: "Route?", options: [] }], [["https://startupbot.ai/a/b"]]],
  [[{ question: "Nothing?", options: [] }], [[]]],
];
const vectors = cases.map(([questions, answers]) => ({ request: { version: 1, questions }, answers, formatted: formatQuestionAnswers(questions, answers) }));
for (const file of ["ios/Tests/CompanionCoreTests/Fixtures/question-answer-v1.json", "android/core/src/test/resources/question-answer-v1.json"]) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(vectors, null, 2) + "\n");
}
