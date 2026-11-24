import type { ModelSelection } from "./wire.ts";

/** The routing and source identity carried by messages during a work-bot handoff. */
export interface WorkBotMessageFields {
  workBotExecutionUncertain?: true;
  workBotRecoveryPending?: true;
  workBotHandoffSource?: { threadId: string; messageId: string; botId?: string };
  workBotRouting?: {
    state: "classifying" | "waiting_choice" | "dispatching" | "interrupted" | "dispatched" | "cancelled";
    requestId?: string;
    sourceBotId?: string;
    ownerKey?: string;
    triggerKind?: "owner" | "user";
    modelSelection?: ModelSelection;
    targetBotId?: string;
    targetThreadId?: string;
    recoveryBlocked?: true;
    stopPending?: { sendId?: string };
  };
  workBotCopy?: { sourceThreadId: string; sourceMessageId: string; requestMessageId: string; status?: "cancelled" | "unsettled" | "settled" | "unknown" };
}
