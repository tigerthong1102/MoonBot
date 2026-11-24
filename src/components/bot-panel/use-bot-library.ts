import { useEffect, useState } from "react";
import type { BotLibrary } from "../../../shared/bot-library";
import { api } from "@/state/api";
import type { Bot } from "@/state/store";
import { knownThreads } from "./library-items";

export function useBotLibrary(bot: Pick<Bot, "id" | "threadId" | "tasks">): BotLibrary | null {
  const [library, setLibrary] = useState<{ key: string; library: BotLibrary } | null>(null);
  const key = JSON.stringify([bot.id, bot.threadId, [...knownThreads(bot)].sort()]);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    api<BotLibrary>(`/api/bots/${encodeURIComponent(bot.id)}/library`, { signal: controller.signal })
      .then((answer) => {
        if (!cancelled && Array.isArray(answer?.pages) && Array.isArray(answer.apps) && Array.isArray(answer.files)) {
          setLibrary({ key, library: answer });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bot.id, key]);
  return library?.key === key ? library.library : null;
}
