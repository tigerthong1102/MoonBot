export const AI_TWIN_PATH = "/api/ai-twin";
export const AI_TWIN_PREVIEW_PATH = AI_TWIN_PATH + "/preview";
export const AI_TWIN_LESSONS_PATH = AI_TWIN_PATH + "/lessons";
export const AI_TWIN_LOOKUP_PATH = AI_TWIN_PATH + "/lookup";
export const AI_TWIN_NAME_MAX = 80;
export const AI_TWIN_STYLE_MAX = 1_200;
export const AI_TWIN_QUESTION_MAX = 1_000;
export const AI_TWIN_LESSON_QUESTION_MAX = 250;
export const AI_TWIN_LESSON_ANSWER_MAX = 750;

export interface AiTwinLesson {
  id: string;
  question: string;
  answer: string;
  source: "owner";
  updatedAt: number;
}

export interface AiTwinPreviewProvider {
  key: string;
  name: string;
  model: string;
}

export interface AiTwinProfile {
  id: string;
  name: string;
  style: string;
  paused: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface AiTwinView {
  twin: AiTwinProfile | null;
  creationEpoch: string;
  preview?: AiTwinPreviewProvider;
  lessons?: AiTwinLesson[];
}
