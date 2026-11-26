import type { RoutineRequestCardData } from "../shared/routine-request.ts";

export interface RoutineRequestOptionCard {
  title: string;
  subtitle: string;
  options: string[];
  answered?: string;
  dismissed?: boolean;
  expired?: boolean;
  requestId?: string;
  tool?: string;
  held?: string;
  autoApplied?: boolean;
  undone?: boolean;
  routineRequest?: RoutineRequestCardData;
}

export interface RoutineRequestMessage {
  id: string;
  requestMessageId?: string;
  card?: RoutineRequestOptionCard;
}

export interface RoutineRequestStore {
  messagesFor(threadId: string): RoutineRequestMessage[];
  appendMessage(threadId: string, message: {
    role: "bot";
    kind: "options";
    requestMessageId?: string;
    card: RoutineRequestOptionCard;
    from?: { botId: string; name: string; color: string };
  }): RoutineRequestMessage;
  patchMessage(threadId: string, messageId: string, patch: { card: RoutineRequestOptionCard }): RoutineRequestMessage | null;
}
