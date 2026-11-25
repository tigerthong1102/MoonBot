// App-event automations on the client: one shared copy of /api/app-triggers, kept current by the app-trigger live
// frames, for the Automations page, its panel and the chat card.
import { useEffect, useSyncExternalStore } from "react";

import type { AppEventAttempt, AppEventCatalog, AppTrigger, AppTriggerFilter, AppTriggersSnapshot, AppTriggerService } from "../../shared/app-triggers";
import type { ServerFrame } from "../../shared/wire";
import { listenLiveFrames } from "@/lib/live-events";
import { api } from "@/state/store";

export type { AppEventAttempt, AppEventCatalog, AppEventType, AppTrigger, AppTriggerFilter, AppTriggerService } from "../../shared/app-triggers";

export interface AppTriggerState {
  loaded: boolean;
  triggers: AppTrigger[];
  attempts: AppEventAttempt[];
  service: AppTriggerService | null;
}

const EMPTY: AppTriggerState = { loaded: false, triggers: [], attempts: [], service: null };
const MAX_ATTEMPTS = 2_000;
let state = EMPTY;
const listeners = new Set<() => void>();
let started = false;
let loading: Promise<void> | null = null;
let pendingFrames: ServerFrame[] | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshAgain = false;

function set(next: AppTriggerState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function applyAppTriggerSnapshot(snapshot: AppTriggersSnapshot): void {
  set({ loaded: true, triggers: snapshot.triggers, attempts: snapshot.attempts.slice(-MAX_ATTEMPTS), service: snapshot.service });
}

export function applyAppTriggerFrame(frame: ServerFrame): void {
  if (frame.kind !== "app-trigger" && frame.kind !== "app-trigger.deleted" && frame.kind !== "app-trigger.attempt" && frame.kind !== "app-trigger.service") return;
  if (pendingFrames) {
    pendingFrames.push(frame);
    if (pendingFrames.length > MAX_ATTEMPTS) pendingFrames.shift();
  }
  if (started) scheduleRefresh();
  applyFrame(frame);
}

function applyFrame(frame: ServerFrame): void {
  if (frame.kind === "app-trigger") {
    const exists = state.triggers.some((trigger) => trigger.id === frame.trigger.id);
    set({ ...state, triggers: exists ? state.triggers.map((trigger) => trigger.id === frame.trigger.id ? frame.trigger : trigger) : [frame.trigger, ...state.triggers] });
  } else if (frame.kind === "app-trigger.deleted") {
    set({ ...state, triggers: state.triggers.filter((trigger) => trigger.id !== frame.triggerId), attempts: state.attempts.filter((attempt) => attempt.triggerId !== frame.triggerId) });
  } else if (frame.kind === "app-trigger.attempt") {
    set({ ...state, attempts: [...state.attempts.filter((attempt) => attempt.id !== frame.attempt.id), frame.attempt].slice(-MAX_ATTEMPTS) });
  } else if (frame.kind === "app-trigger.service") {
    set({ ...state, service: frame.service });
  }
}

function scheduleRefresh(delay = 500): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (loading) refreshAgain = true;
    else void loadAppTriggers();
  }, delay);
}

function refresh(): Promise<void> {
  if (loading) return loading;
  pendingFrames = [];
  loading = api<AppTriggersSnapshot>("/api/app-triggers")
    .then((snapshot) => {
      const frames = pendingFrames ?? [];
      pendingFrames = null;
      applyAppTriggerSnapshot(snapshot);
      for (const frame of frames) applyFrame(frame);
    })
    .finally(() => {
      pendingFrames = null;
      loading = null;
      if (refreshAgain) { refreshAgain = false; scheduleRefresh(); }
    });
  return loading;
}

export async function loadAppTriggers(): Promise<void> {
  try { await refresh(); }
  catch { if (started && !refreshTimer) scheduleRefresh(2_000); }
}

function start(): void {
  // A remote client reaches only routines, as for webhooks.
  if (started || (typeof window !== "undefined" && window.ogb?.remoteClient?.active)) return;
  started = true;
  listenLiveFrames({ onFrame: applyAppTriggerFrame, onMissedFrames: () => void loadAppTriggers() });
  void loadAppTriggers();
}

export function useAppTriggers(): AppTriggerState {
  useEffect(start, []);
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => state, () => EMPTY);
}

export interface AppTriggerDraft {
  botId: string;
  name: string;
  prompt: string;
  app: string;
  event: string;
  account?: string;
  filter?: AppTriggerFilter;
  config?: Record<string, unknown>;
  sameConversation?: boolean;
}

const put = (trigger: AppTrigger) => applyAppTriggerFrame({ kind: "app-trigger", botId: trigger.botId, trigger });

export const appTriggerApi = {
  events: (botId: string) => api<AppEventCatalog>(`/api/app-triggers/events?${new URLSearchParams({ botId })}`),
  async create(draft: AppTriggerDraft) {
    const { trigger } = await api<{ trigger: AppTrigger }>("/api/app-triggers", { method: "POST", body: JSON.stringify(draft) });
    put(trigger);
    return trigger;
  },
  async update(id: string, patch: Partial<Pick<AppTrigger, "name" | "prompt" | "enabled" | "config" | "sameConversation">> & { filter?: AppTriggerFilter | null }) {
    const { trigger } = await api<{ trigger: AppTrigger }>(`/api/app-triggers/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    put(trigger);
    return trigger;
  },
  async remove(id: string) {
    await api(`/api/app-triggers/${id}`, { method: "DELETE" });
    applyAppTriggerFrame({ kind: "app-trigger.deleted", triggerId: id });
  },
  test: (id: string) => api(`/api/app-triggers/${id}/test`, { method: "POST" }),
  async sync() {
    await api<AppTriggersSnapshot>("/api/app-triggers/sync", { method: "POST" });
    if (loading) await loading.catch(() => {});
    await refresh();
  },
};
