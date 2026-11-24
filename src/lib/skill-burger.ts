import { useCallback, useEffect, useState } from "react";

import { api } from "@/state/api";
import type { SavedWorkflow } from "../../shared/skill-burger/saved";

export type { SavedWorkflow };

const CHANGED = "omb:skill-burgers-changed";
export const RUN_CARD_KEY = "omb-show-run-card";

export function burgerStartsFolded(): boolean {
  try {
    return globalThis.localStorage?.getItem(RUN_CARD_KEY) === "0";
  } catch {
    return false;
  }
}

function changed(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

export async function saveBurger(input: { botId: string; threadId: string; summary?: string; name?: string }): Promise<SavedWorkflow> {
  const { skill } = await api<{ skill: SavedWorkflow }>("/api/skill-burgers", { method: "POST", body: JSON.stringify(input) });
  changed();
  return skill;
}

const placeQuery = (skill: Pick<SavedWorkflow, "everyChat" | "botId">) => (skill.everyChat || !skill.botId ? "" : `botId=${encodeURIComponent(skill.botId)}`);
const path = (skill: Pick<SavedWorkflow, "name" | "everyChat" | "botId">, extra = "") => {
  const query = [placeQuery(skill), extra].filter(Boolean).join("&");
  return `/api/skill-burgers/${encodeURIComponent(skill.name)}${query ? `?${query}` : ""}`;
};

export async function removeBurger(skill: Pick<SavedWorkflow, "name" | "sha256" | "everyChat" | "botId">): Promise<void> {
  await api(path(skill, `sha256=${encodeURIComponent(skill.sha256)}`), { method: "DELETE" });
  changed();
}

export async function setBurgerEveryChat(skill: Pick<SavedWorkflow, "name" | "sha256" | "everyChat" | "botId">, everyChat: boolean): Promise<SavedWorkflow> {
  const { skill: moved } = await api<{ skill: SavedWorkflow }>(`/api/skill-burgers/${encodeURIComponent(skill.name)}`, {
    method: "PATCH", body: JSON.stringify({ everyChat, sha256: skill.sha256, ...(skill.everyChat || !skill.botId ? {} : { botId: skill.botId }) }),
  });
  changed();
  return moved;
}

export async function renameBurger(skill: Pick<SavedWorkflow, "name" | "sha256" | "everyChat" | "botId">, to: string): Promise<SavedWorkflow> {
  const { skill: renamed } = await api<{ skill: SavedWorkflow }>(`/api/skill-burgers/${encodeURIComponent(skill.name)}`, {
    method: "PATCH", body: JSON.stringify({ rename: to, sha256: skill.sha256, ...(skill.everyChat || !skill.botId ? {} : { botId: skill.botId }) }),
  });
  changed();
  return renamed;
}

export function useSavedBurgers(): { skills: SavedWorkflow[] | null; error: boolean; refresh: () => void } {
  const [skills, setSkills] = useState<SavedWorkflow[] | null>(null);
  const [error, setError] = useState(false);
  const refresh = useCallback(() => {
    api<{ skills: SavedWorkflow[] }>("/api/skill-burgers")
      .then((result) => { setSkills(result.skills); setError(false); })
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, [refresh]);
  return { skills, error, refresh };
}

export async function readBurgerWorkflow(skill: Pick<SavedWorkflow, "name" | "everyChat" | "botId">): Promise<unknown> {
  const { workflow } = await api<{ workflow: unknown }>(path(skill));
  return workflow;
}

export async function restoreBurger(skill: Pick<SavedWorkflow, "name" | "everyChat" | "botId">, workflow: unknown): Promise<SavedWorkflow> {
  const { skill: restored } = await api<{ skill: SavedWorkflow }>("/api/skill-burgers", {
    method: "POST", body: JSON.stringify({ name: skill.name, workflow, ...(skill.botId ? { botId: skill.botId } : {}), ...(skill.everyChat ? { everyChat: true } : {}) }),
  });
  changed();
  return restored;
}

const savedRuns = new Map<string, SavedWorkflow>();
export const savedRun = (run: string) => savedRuns.get(run);
export function rememberSavedRun(run: string, skill: SavedWorkflow | null): void {
  if (skill) savedRuns.set(run, skill);
  else savedRuns.delete(run);
}
