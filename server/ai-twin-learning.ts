import {
  AI_TWIN_LESSON_ANSWER_MAX, AI_TWIN_LESSON_QUESTION_MAX, type AiTwinLearnedStyle, type AiTwinLearningExample, type AiTwinLearningView,
} from "../shared/ai-twin.ts";
import { redactSecretsInText } from "../shared/redact.ts";
import { twinLessonKey } from "./ai-twin-lessons.ts";
import type { Message } from "./store.ts";

export type TwinLearningRow = Pick<AiTwinLearningExample, "thread" | "message" | "text"> & { ts: number; replyToId?: string };

export function twinLearningText(line: Message): string | undefined {
  if (line.role !== "user" || line.kind !== "text" || line.automated || line.relayed || line.via
      || line.fromApp || line.aside || line.peerAsk || line.automation || line.dataContext || line.attachments?.length || line.pointed?.length) return;
  return twinLearningSample(line.text);
}

export function twinLearningSample(value?: string): string | undefined {
  const text = value?.trim();
  if (!text || text.length < 12 || text.length > 2_000 || redactSecretsInText(text) !== text) return;
  if (/(?:https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\d[\s().+-]*){7,})/i.test(text)) return;
  return text;
}

export const TWIN_STYLE_SAMPLE_LIMIT = 120;

function twinLearnedStyle(rows: readonly { text: string }[]): AiTwinLearnedStyle | undefined {
  if (rows.length < 3) return;
  const wordCounts = rows.map(({ text }) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0).sort((a, b) => a - b);
  return {
    samples: rows.length,
    typicalWords: wordCounts[Math.floor(wordCounts.length / 2)]!,
    frequentlyUsesLists: rows.filter(({ text }) => /^\s*(?:[-*]|\d+[.)])\s+\S/m.test(text)).length * 3 >= rows.length,
    frequentlyAsksQuestions: rows.filter(({ text }) => /[?？]\s*$/.test(text)).length * 2 >= rows.length,
  };
}

function newestFirst(a: TwinLearningRow, b: TwinLearningRow): number {
  return b.ts - a.ts || a.message.localeCompare(b.message);
}

export function recentTwinStyle(rows: TwinLearningRow[]): AiTwinLearnedStyle | undefined {
  return twinLearnedStyle(rows.sort(newestFirst).slice(0, TWIN_STYLE_SAMPLE_LIMIT));
}

export function twinLearningView(
  conversations: AiTwinLearningView["conversations"], rooms: AiTwinLearningView["rooms"],
  rows: TwinLearningRow[],
): AiTwinLearningView {
  const ordered = rows.sort(newestFirst);
  const recent = ordered.slice(0, TWIN_STYLE_SAMPLE_LIMIT);
  const byMessage = new Map(ordered.map((row) => [row.thread + ":" + row.message, row]));
  const examples: AiTwinLearningExample[] = [];
  const questions = new Set<string>();
  const paired = new Set<string>();
  for (const { thread, message, replyToId, text } of ordered) {
    const pair = /^(?:Q|Question|Hỏi|Câu hỏi)[ \t]*[:：][ \t]*([^\r\n]+)\r?\n(?:A|Answer|Đáp|Trả lời)[ \t]*[:：][ \t]*([\s\S]+)$/iu.exec(text);
    const answered = replyToId && byMessage.get(thread + ":" + replyToId)?.text;
    const question = pair?.[1]?.trim() ?? (answered && !/[\r\n]/.test(answered) && /[?？]$/u.test(answered) ? answered : undefined);
    const answer = pair?.[2]?.trim() ?? (/[?？]$/u.test(text) ? "" : text);
    if (!question || question.length > AI_TWIN_LESSON_QUESTION_MAX || !answer || answer.length > AI_TWIN_LESSON_ANSWER_MAX) continue;
    paired.add(thread + ":" + message);
    const key = twinLessonKey(question);
    if (!key || questions.has(key)) continue;
    questions.add(key);
    examples.push({ thread, message, question, text: answer });
    if (examples.length === 12) break;
  }
  for (const { thread, message, text } of recent) {
    if (examples.length === 12) break;
    if (!/[?？]$/u.test(text) && text.length <= AI_TWIN_LESSON_ANSWER_MAX && !paired.has(thread + ":" + message)) {
      examples.push({ thread, message, text });
    }
  }
  return { conversations, rooms, style: twinLearnedStyle(recent), examples };
}
