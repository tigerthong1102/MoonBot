import type { AppEventAttempt, AppTrigger, AppTriggerService } from "../shared/app-triggers.ts";
import type { AppTriggerBroker } from "./app-trigger-broker.ts";
import type { ConnectedApps } from "./app-trigger-config.ts";
import type { RoutineRunOn } from "./routines.ts";

export type AppTriggerFrame = { kind: "app-trigger"; botId: string; trigger: AppTrigger } | { kind: "app-trigger.deleted"; triggerId: string }
  | { kind: "app-trigger.attempt"; botId: string; attempt: AppEventAttempt } | { kind: "app-trigger.service"; service: AppTriggerService };

export interface AppTriggerManagerOptions {
  file?: string;
  now?: () => number;
  broker: AppTriggerBroker;
  /** Whether app events can work here at all, and why not. Checked on every loop, since access arrives late. */
  service: () => { available: true } | { available: false; reason: "self-hosted" | "unavailable" | "off" };
  connectedApps: () => Promise<ConnectedApps>;
  botState: (botId: string) => "ready" | "busy" | "missing";
  linkedBots?: (first: string, second: string) => boolean;
  acknowledgmentScope?: () => string | null;
  installationScope?: (signal?: AbortSignal) => Promise<string | null>;
  runs: {
    enqueue(input: { webhookId: string; webhookName: string; prompt: string; botId: string; runOn: RoutineRunOn; deliveryId: string; receivedAt: number; eventSource: "app"; sameConversation?: boolean }): { id: string };
    merge(triggerId: string, eventId: string, sameConversation: boolean, merge: (prompt: string) => string | null): { id: string } | null;
    receipt(triggerId: string, eventId: string): { id: string } | null;
    eventRecipients?(eventId: string): Array<string | null>;
    pending(triggerId: string): number;
    cancelQueued(triggerId: string, message: string): void;
  };
  emit?: (frame: AppTriggerFrame) => void;
  log?: (line: string) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}
