export const AI_TWIN_PATH = "/api/ai-twin";
export const AI_TWIN_NAME_MAX = 80;
export const AI_TWIN_STYLE_MAX = 1_200;

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
}
