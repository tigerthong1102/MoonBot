export const AI_TWIN_PATH = "/api/ai-twin";
export const AI_TWIN_PREVIEW_PATH = AI_TWIN_PATH + "/preview";
export const AI_TWIN_NAME_MAX = 80;
export const AI_TWIN_STYLE_MAX = 1_200;
export const AI_TWIN_QUESTION_MAX = 1_000;

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
}
