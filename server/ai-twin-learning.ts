import type { AiTwinLearnedStyle, AiTwinLearningView } from "../shared/ai-twin.ts";
import { redactSecretsInText } from "../shared/redact.ts";
import type { Message } from "./store.ts";

export function twinLearningText(line: Message): string | undefined {
  if (line.role !== "user" || line.kind !== "text" || line.automated || line.relayed || line.via
      || line.fromApp || line.aside || line.peerAsk || line.automation || line.dataContext || line.attachments?.length || line.pointed?.length) return;
  const text = line.text?.trim();
  if (!text || text.length < 12 || text.length > 2_000 || redactSecretsInText(text) !== text) return;
  if (/(?:https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\d[\s().+-]*){7,})/i.test(text)) return;
  return text;
}

export function twinLearnedStyle(rows: readonly { text: string }[]): AiTwinLearnedStyle | undefined {
  if (rows.length < 3) return;
  const wordCounts = rows.map(({ text }) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0).sort((a, b) => a - b);
  return {
    samples: rows.length,
    typicalWords: wordCounts[Math.floor(wordCounts.length / 2)]!,
    frequentlyUsesLists: rows.filter(({ text }) => /^\s*(?:[-*]|\d+[.)])\s+\S/m.test(text)).length * 3 >= rows.length,
    frequentlyAsksQuestions: rows.filter(({ text }) => /[?？]\s*$/.test(text)).length * 2 >= rows.length,
  };
}

export function twinLearningView(
  conversations: AiTwinLearningView["conversations"], rooms: AiTwinLearningView["rooms"],
  rows: Array<AiTwinLearningView["examples"][number] & { ts: number }>,
): AiTwinLearningView {
  const ordered = rows.sort((a, b) => b.ts - a.ts || a.message.localeCompare(b.message)).slice(0, 120);
  const examples = ordered.filter(({ text }) => !/[?？]\s*$/.test(text) && text.length <= 750).slice(0, 12)
    .map(({ thread, message, text }) => ({ thread, message, text }));
  return { conversations, rooms, style: twinLearnedStyle(ordered), examples };
}
