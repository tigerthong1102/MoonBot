import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { settingFix } from "../../shared/setting-fixes.ts";
import { writeFileAtomic } from "../atomic.ts";
import type { Message, Store } from "../store.ts";

export const SETTING_NUDGES_FILE = "setting-nudges.json";
const AFTER = 2;
const MAX_THREADS = 500;

export interface NudgeTurn {
  tools: boolean;
  /** app_settings set would take a change in this turn: the owner's own conversation, not a guest's. */
  owner: boolean;
  model: string;
}

interface ThreadState {
  model: string;
  from?: string;
  noted?: string;
}

const NOTE = (count: number, owner: boolean) => `\n\nStartupBot note: your last ${count} turns in this conversation failed because your AI could not answer `
  + "(out of credits, at a usage or rate limit, overloaded, or unable to run your model). Start your reply with one plain sentence saying so, and "
  + (owner ? "offer to switch you to another model; if they agree, choose one with list_models and change it with app_settings set bots.model."
    : "say the owner of this place can switch you to another model; you cannot change it from this conversation.")
  + " Say it this once only; if they decline or ignore it, do not bring it up again.";

export function createSettingNudges(deps: { dataDir: string; store: Pick<Store, "messagesFor"> }) {
  const file = join(deps.dataDir, SETTING_NUDGES_FILE);
  let threads: Record<string, ThreadState> = {};
  try {
    if (existsSync(file)) threads = JSON.parse(readFileSync(file, "utf8")) as typeof threads;
  } catch {
    threads = {};
  }
  const save = () => {
    const ids = Object.keys(threads);
    if (ids.length > MAX_THREADS) for (const old of ids.slice(0, ids.length - MAX_THREADS)) delete threads[old];
    writeFileAtomic(file, JSON.stringify(threads));
  };
  const answered = (message: Message) => message.role === "bot" && message.kind === "text";
  const indexOf = (messages: readonly Message[], id: string | undefined) => (id ? messages.findIndex((message) => message.id === id) : -1);

  return {
    note(threadId: string, turn: NudgeTurn): string {
      const messages = deps.store.messagesFor(threadId);
      const last = messages.at(-1);
      const before = threads[threadId];
      const state: ThreadState = before?.model === turn.model ? before : { ...before, model: turn.model, ...(before && last ? { from: last.id } : {}) };
      if (state !== before) { threads[threadId] = state; save(); }
      if (!turn.tools || !last) return "";
      const noted = indexOf(messages, state.noted);
      if (noted >= 0 && messages.slice(noted + 1).some(answered)) return "";
      const lastAnswer = messages.findLastIndex(answered);
      const count = messages.slice(Math.max(lastAnswer, indexOf(messages, state.from)) + 1).filter((message) => message.tool && settingFix(message.tool) === "model").length;
      if (count < AFTER) return "";
      threads[threadId] = { ...state, noted: last.id };
      save();
      return NOTE(count, turn.owner);
    },
  };
}
