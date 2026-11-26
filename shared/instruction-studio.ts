import type { ModelSelection } from "./wire.ts";
export const MAX_INSTRUCTION_CASES = 10;
export interface InstructionCase { question: string; expected: string }
export interface InstructionDraft {
  id: string | null;
  baseRevision: string;
  soul: string;
  cases: InstructionCase[];
  selection: ModelSelection;
}
export interface InstructionStudioView {
  revision: string;
  liveSoul: string;
  draft: InstructionDraft;
  liveSelection: ModelSelection;
  history: Array<{ id: string; at: number; instanceId: string; model: string; instructionsPreview: string; effort?: string; canRestore: boolean }>;
  canTest: boolean;
}
export interface InstructionCaseResult {
  live: { answer: string; pass: boolean };
  draft: { answer: string; pass: boolean };
}
