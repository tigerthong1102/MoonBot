export const AI_TWIN_PATH = "/api/ai-twin";
export const AI_TWIN_PREVIEW_PATH = AI_TWIN_PATH + "/preview";
export const AI_TWIN_LESSONS_PATH = AI_TWIN_PATH + "/lessons";
export const AI_TWIN_FORGET_MANY_PATH = AI_TWIN_PATH + "/lessons/forget-many";
export const AI_TWIN_LOOKUP_PATH = AI_TWIN_PATH + "/lookup";
export const AI_TWIN_LEARNING_PATH = AI_TWIN_PATH + "/learning";
export const AI_TWIN_DELEGATION_PATH = AI_TWIN_PATH + "/delegation";
export const AI_TWIN_PHONE_PATH = AI_TWIN_PATH + "/phone";
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
  origin?: "manual" | "conversation";
  allowProvider?: true;
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
  unavailableLessonIds?: string[];
  controls?: AiTwinControls;
  canEnablePhone?: boolean;
  canReviewOwnerStyle?: true;
}

export interface AiTwinScope {
  id: string;
  label: string;
}

export interface AiTwinDelegation {
  room: string;
  lesson: string;
}

export interface AiTwinControls {
  sourceIds: string[];
  delegations: AiTwinDelegation[];
  phone: boolean;
}

export interface AiTwinLearningExample {
  thread: string;
  message: string;
  digest?: string;
  question?: string;
  text: string;
}

export interface AiTwinLearningView {
  conversations: AiTwinScope[];
  rooms: AiTwinScope[];
  style?: AiTwinLearnedStyle;
  examples: AiTwinLearningExample[];
}

export interface AiTwinLearnedStyle {
  samples: number;
  typicalWords: number;
  frequentlyUsesLists: boolean;
  frequentlyAsksQuestions: boolean;
}
