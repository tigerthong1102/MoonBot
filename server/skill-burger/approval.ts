import type { RequestOutcome } from "../contracts.ts";
import { createChatToolApproval } from "../drivers/chat-tool-approval.ts";

type Event =
  | { type: "request.opened"; requestId: string; requestType: "permission"; tool: string; summary: string; requiresExplicitApproval: true }
  | { type: "request.resolved"; requestId: string; behavior: "allow" | "deny"; source: "user" | "timeout" | "system" };

export function createWorkflowApprovals(publish: (threadId: string, event: Event) => void) {
  const pending = new Map<string, { threadId: string; active: () => boolean; answer: (behavior: "allow" | "deny" | "answer") => RequestOutcome }>();
  return {
    has(threadId: string, id: string): boolean {
      return pending.get(id)?.threadId === threadId;
    },
    async ask(input: { threadId: string; tool: string; summary: string; signal: AbortSignal; active: () => boolean }): Promise<boolean> {
      if (input.signal.aborted || !input.active() || pending.size >= 200) return false;
      const approval = createChatToolApproval({
        signal: input.signal,
        open: (ask) => {
          pending.set(ask.id, { threadId: input.threadId, active: input.active, answer: (behavior) => approval.answer(ask.id, behavior) });
          publish(input.threadId, { type: "request.opened", requestId: ask.id, requestType: "permission", tool: ask.tool, summary: ask.summary, requiresExplicitApproval: true });
        },
        resolved: (ask, allowed, source) => {
          pending.delete(ask.id);
          publish(input.threadId, { type: "request.resolved", requestId: ask.id, behavior: allowed ? "allow" : "deny", source });
        },
        openQuestion: () => {},
        resolvedQuestion: () => {},
      });
      return await approval.ask(input.tool, input.summary) && !input.signal.aborted && input.active();
    },
    answer(threadId: string, id: string, behavior: "allow" | "deny" | "answer"): RequestOutcome {
      const found = pending.get(id);
      return found?.threadId === threadId && found.active() ? found.answer(behavior) : "unavailable";
    },
  };
}
