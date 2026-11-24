import type { Message } from "./store.ts";

type Routing = NonNullable<Message["workBotRouting"]>;
type RoutingState = Routing["state"];
type Target = { botId: string; threadId: string };
type Offer = { requestId: string } | { interrupted: true };
export type WorkBotChoiceResult = "accepted" | "interrupted" | "not_claimed";

export interface WorkBotRoutingDependencies {
  message(threadId: string, messageId: string): Message | undefined;
  patch(threadId: string, messageId: string, expected: RoutingState, routing: Routing): boolean;
  offer(threadId: string, messageId: string, signal: AbortSignal): Promise<Offer | null>;
  mainTarget(threadId: string, messageId: string): Target | null;
  decision(threadId: string, messageId: string, requestId: string): Promise<{ state: "pending" | "interrupted" } | { state: "chosen"; target: Target }>;
  dispatch(threadId: string, messageId: string, target: Target): Promise<void>;
  recoverDispatch?(threadId: string, messageId: string, route: Routing): boolean;
  finishRecovery?(threadId: string, messageId: string, route: Routing): void;
  report(error: unknown): void;
}

export class WorkBotRouter {
  private readonly inFlight = new Map<string, AbortController>();
  private readonly deps: WorkBotRoutingDependencies;
  private readonly timeoutMs: number;

  constructor(deps: WorkBotRoutingDependencies, timeoutMs = 90_000) {
    this.deps = deps;
    this.timeoutMs = timeoutMs;
  }

  private key(threadId: string, messageId: string): string {
    return JSON.stringify([threadId, messageId]);
  }

  async classify(threadId: string, messageId: string): Promise<void> {
    const key = this.key(threadId, messageId);
    if (this.inFlight.has(key)) return;
    const route = this.deps.message(threadId, messageId)?.workBotRouting;
    if (route?.state !== "classifying") return;
    const controller = new AbortController();
    this.inFlight.set(key, controller);
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let offer: Offer | null;
      try {
        offer = await Promise.race([
          this.deps.offer(threadId, messageId, controller.signal),
          new Promise<null>(resolve => controller.signal.addEventListener("abort", () => resolve(null), { once: true })),
        ]);
      } catch {
        offer = null;
      }
      if (this.deps.message(threadId, messageId)?.workBotRouting?.state !== "classifying") return;
      if (offer && "interrupted" in offer) {
        this.deps.patch(threadId, messageId, "classifying", { ...route, state: "interrupted" });
        return;
      }
      if (offer && !controller.signal.aborted) {
        if (this.deps.patch(threadId, messageId, "classifying", { ...route, state: "waiting_choice", requestId: offer.requestId })) {
          await this.reconcileChoice(threadId, messageId);
        }
        return;
      }
      const target = this.deps.mainTarget(threadId, messageId);
      if (!target) {
        this.deps.patch(threadId, messageId, "classifying", { ...route, state: "interrupted" });
        return;
      }
      await this.dispatch(threadId, messageId, "classifying", target);
    } finally {
      clearTimeout(timeout);
      if (this.inFlight.get(key) === controller) this.inFlight.delete(key);
    }
  }

  async choose(threadId: string, messageId: string, requestId: string, target: Target): Promise<WorkBotChoiceResult> {
    const route = this.deps.message(threadId, messageId)?.workBotRouting;
    if (route?.state !== "waiting_choice" || route.requestId !== requestId) return "not_claimed";
    return this.dispatch(threadId, messageId, "waiting_choice", target);
  }

  cancel(threadId: string, messageId: string): boolean {
    const route = this.deps.message(threadId, messageId)?.workBotRouting;
    if (route?.state !== "classifying" && route?.state !== "waiting_choice") return false;
    if (!this.deps.patch(threadId, messageId, route.state, { ...route, state: "cancelled" })) return false;
    this.inFlight.get(this.key(threadId, messageId))?.abort();
    return true;
  }

  async recover(threadId: string, messageId: string): Promise<void> {
    try {
      const route = this.deps.message(threadId, messageId)?.workBotRouting;
      if (route?.state === "classifying") await this.classify(threadId, messageId);
      else if (route?.state === "dispatching" || route?.state === "dispatched" || route?.state === "interrupted") this.recoverDispatch(threadId, messageId);
      else if (route?.state === "waiting_choice") await this.reconcileChoice(threadId, messageId);
    } catch (error) {
      this.deps.report(error);
    }
  }

  recoverDispatch(threadId: string, messageId: string): void {
    const route = this.deps.message(threadId, messageId)?.workBotRouting;
    if (!route || !["dispatching", "dispatched", "interrupted"].includes(route.state)) return;
    if (this.deps.recoverDispatch && !this.deps.recoverDispatch(threadId, messageId, route)) return;
    if (route.state !== "interrupted" && !this.deps.patch(threadId, messageId, route.state, { ...route, state: "interrupted" })) return;
    this.deps.finishRecovery?.(threadId, messageId, route);
  }

  async reconcileChoice(threadId: string, messageId: string): Promise<void> {
    const route = this.deps.message(threadId, messageId)?.workBotRouting;
    if (route?.state !== "waiting_choice") return;
    if (!route.requestId) {
      this.deps.patch(threadId, messageId, "waiting_choice", { ...route, state: "interrupted" });
      return;
    }
    const decision = await this.deps.decision(threadId, messageId, route.requestId);
    if (decision.state === "chosen") await this.choose(threadId, messageId, route.requestId, decision.target);
    else if (decision.state === "interrupted") this.deps.patch(threadId, messageId, "waiting_choice", { ...route, state: "interrupted" });
  }

  private async dispatch(threadId: string, messageId: string, expected: "classifying" | "waiting_choice", target: Target): Promise<WorkBotChoiceResult> {
    const route = this.deps.message(threadId, messageId)?.workBotRouting;
    if (!route || route.state !== expected) return "not_claimed";
    const claimed: Routing = { ...route, state: "dispatching", targetBotId: target.botId, targetThreadId: target.threadId };
    if (!this.deps.patch(threadId, messageId, expected, claimed)) return "not_claimed";
    try {
      await this.deps.dispatch(threadId, messageId, target);
      return this.deps.patch(threadId, messageId, "dispatching", { ...claimed, state: "dispatched" }) ? "accepted" : "interrupted";
    } catch (error) {
      this.deps.report(error);
      this.deps.patch(threadId, messageId, "dispatching", { ...claimed, state: "interrupted" });
      return "interrupted";
    }
  }
}
