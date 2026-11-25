import { z } from "zod";
import {
  AI_TWIN_LESSON_ANSWER_MAX, AI_TWIN_LESSON_QUESTION_MAX, AI_TWIN_QUESTION_MAX,
} from "../shared/ai-twin.ts";

export const MAX_TWIN_LESSONS = 40;
const question = z.string().trim().min(1).max(AI_TWIN_LESSON_QUESTION_MAX);
const answer = z.string().trim().min(1).max(AI_TWIN_LESSON_ANSWER_MAX);

export const twinLessonFields = { question, answer };
export const twinLessonLookupFields = { question: z.string().trim().min(1).max(AI_TWIN_QUESTION_MAX) };
export const storedTwinLesson = z.strictObject({
  ...twinLessonFields,
  id: z.uuid(),
  source: z.literal("owner"),
  updatedAt: z.number().int().nonnegative(),
});

export function twinLessonKey(text: string): string {
  return text.normalize("NFC").toLowerCase().trim().replace(/[?.!？。！]+$/u, "").trim().replace(/\s+/gu, " ");
}
