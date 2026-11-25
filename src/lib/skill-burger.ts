import { useCallback, useEffect, useState } from "react";

import { api } from "@/state/api";
import type { DraftChoices, DraftView } from "../../shared/skill-burger/draft-view";
import type { Workflow } from "../../shared/skill-burger/format";
import type { SavedWorkflow } from "../../shared/skill-burger/saved";

export type { DraftChoices, DraftView, SavedWorkflow };

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

export async function saveBurger(input: { botId: string; threadId: string; summary?: string; name?: string; shareConsent?: true } & DraftChoices): Promise<SavedWorkflow> {
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

export async function setBurgerEveryChat(skill: Pick<SavedWorkflow, "name" | "sha256" | "everyChat" | "botId">, everyChat: boolean, shareConsent?: true): Promise<SavedWorkflow> {
  const { skill: moved } = await api<{ skill: SavedWorkflow }>(`/api/skill-burgers/${encodeURIComponent(skill.name)}`, {
    method: "PATCH", body: JSON.stringify({ everyChat, sha256: skill.sha256, ...(shareConsent ? { shareConsent } : {}), ...(skill.everyChat || !skill.botId ? {} : { botId: skill.botId }) }),
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

export async function restoreBurger(skill: Pick<SavedWorkflow, "name" | "everyChat" | "botId">, workflow: unknown, shareConsent?: true): Promise<SavedWorkflow> {
  const { skill: restored } = await api<{ skill: SavedWorkflow }>("/api/skill-burgers", {
    method: "POST", body: JSON.stringify({ name: skill.name, workflow, ...(shareConsent ? { shareConsent } : {}), ...(skill.botId ? { botId: skill.botId } : {}), ...(skill.everyChat ? { everyChat: true } : {}) }),
  });
  changed();
  return restored;
}

/** The top bun's one line for a finished run, from the bot's small text model; null when there is none. */
export async function fetchBurgerSummary(botId: string, threadId: string): Promise<string | null> {
  try {
    const { summary } = await api<{ summary: string | null }>("/api/skill-burger-summary", { method: "POST", body: JSON.stringify({ botId, threadId }) });
    return typeof summary === "string" && summary ? summary : null;
  } catch {
    return null;
  }
}

/** The finished run as the card explains it: goal, inputs, steps with who did what and what came back. */
export async function fetchBurgerDraft(botId: string, threadId: string): Promise<DraftView | null> {
  try {
    const { draft } = await api<{ draft: DraftView | null }>("/api/skill-burger-draft", { method: "POST", body: JSON.stringify({ botId, threadId }) });
    return draft;
  } catch {
    return null;
  }
}

/** One recent run of a saved burger, as its card lists them. */
export interface BurgerRunRecord {
  run: string;
  botId: string;
  threadId: string;
  at: number;
  status: "ok" | "failed" | "waiting" | "cancelled";
  steps: Array<{ id: string; label: string; state: string }>;
  failed?: { step: string; label: string; error: string };
  defaults?: string[];
  fixedBy?: string;
}

export async function fetchBurgerRuns(name: string): Promise<BurgerRunRecord[]> {
  try {
    const { runs } = await api<{ runs: BurgerRunRecord[] }>(`/api/skill-burgers/${encodeURIComponent(name)}/runs`);
    return runs;
  } catch {
    return [];
  }
}

/** "Update the burger with this fix": the steps the bot took to get past a failed step replace that step. */
export async function keepBurgerFix(input: { name: string; everyChat: boolean; runBotId: string; threadId: string; run: string; step: string; shareConsent?: true }): Promise<{ skill: SavedWorkflow; undo: string }> {
  const { name, everyChat, ...rest } = input;
  const result = await api<{ skill: SavedWorkflow; undo: string }>(`/api/skill-burgers/${encodeURIComponent(name)}/fix`, {
    method: "POST", body: JSON.stringify({ ...rest, ...(everyChat ? {} : { botId: input.runBotId }) }),
  });
  changed();
  return result;
}

/** Runs saved in this window, by run: a card that comes back (another chat opened, then this one) shows the save. */
const savedRuns = new Map<string, SavedWorkflow>();
export const savedRun = (run: string) => savedRuns.get(run);
export function rememberSavedRun(run: string, skill: SavedWorkflow | null): void {
  if (skill) savedRuns.set(run, skill);
  else savedRuns.delete(run);
}

/** A Skill Burger as `botId` would run it by name: its own first, then one used in every chat. */
export async function fetchRunnable(name: string, botId: string): Promise<{ workflow: Workflow; everyChat: boolean } | null> {
  try {
    return await api<{ workflow: Workflow; everyChat: boolean }>(`/api/skill-burgers/${encodeURIComponent(name)}?runner=${encodeURIComponent(botId)}`);
  } catch {
    return null;
  }
}

/** What Run sends: the burger's own slash command, which the bot runs with its run_workflow tool, with the inputs the
 * person gave on one line ("site: https://example.org"), so the run never reuses last time's values by surprise. */
export const runCommand = (name: string, inputs: Record<string, string> = {}) => {
  const given = Object.entries(inputs).filter(([, value]) => value.trim()).map(([key, value]) => `${key}: ${value.trim().replace(/\s+/g, " ")}`);
  return given.length ? `/${name} ${given.join("; ")}` : `/${name}`;
};

/** One tap's "Add the path": the steps the bot did by judgement for a case nobody had saved become that case's steps. */
export async function addBurgerPath(input: { name: string; everyChat: boolean; runBotId: string; threadId: string; run: string; decide: string; case: string; shareConsent?: true }): Promise<{ skill: SavedWorkflow; undo: string }> {
  const { name, everyChat, ...rest } = input;
  const result = await api<{ skill: SavedWorkflow; undo: string }>(`/api/skill-burgers/${encodeURIComponent(name)}/paths`, {
    method: "POST", body: JSON.stringify({ ...rest, ...(everyChat ? {} : { botId: input.runBotId }) }),
  });
  changed();
  return result;
}

/** Undo of a change to a burger's steps. */
export async function undoBurgerEdit(input: { name: string; everyChat: boolean; botId: string; undo: string }): Promise<void> {
  await api(`/api/skill-burgers/${encodeURIComponent(input.name)}`, { method: "PATCH", body: JSON.stringify({ undo: input.undo, ...(input.everyChat ? {} : { botId: input.botId }) }) });
  changed();
}

/** The burger `botId` runs by `name`, read again whenever a burger changes. */
export function useRunnable(name: string | null, botId: string): { workflow: Workflow; everyChat: boolean } | null {
  const [found, setFound] = useState<{ key: string; value: { workflow: Workflow; everyChat: boolean } | null } | null>(null);
  const key = name ? `${botId}:${name}` : "";
  useEffect(() => {
    if (!name) return;
    let current = true;
    const read = () => { void fetchRunnable(name, botId).then((value) => { if (current) setFound({ key: `${botId}:${name}`, value }); }); };
    read();
    window.addEventListener(CHANGED, read);
    return () => { current = false; window.removeEventListener(CHANGED, read); };
  }, [name, botId]);
  return found?.key === key ? found.value : null;
}

type RunDispatch = (action: { type: "select"; id: string } | { type: "send"; botId: string; text: string; threadId: string }) => void;

/** Run: opens the bot's chat and sends the burger's slash command there, as a person would type it. */
export function runBurgerIn(dispatch: RunDispatch, bot: { id: string; threadId: string }, name: string, inputs: Record<string, string> = {}): void {
  dispatch({ type: "select", id: bot.id });
  dispatch({ type: "send", botId: bot.id, text: runCommand(name, inputs), threadId: bot.threadId });
}
