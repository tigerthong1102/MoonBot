export type ComputerPanelView = "computer" | "android" | "browser" | "routines" | "files" | "data";

type PanelTabsContext = { advanced: boolean; androidConnected: boolean };

export function computerPanelTabs({ advanced, androidConnected }: PanelTabsContext): ComputerPanelView[] {
  const android = androidConnected ? (["android"] as const) : [];
  return advanced
    ? ["computer", "routines", ...android, "browser", "data"]
    : ["computer", ...android, "browser", "data", "files"];
}

export function resolveComputerPanelView(view: ComputerPanelView, context: PanelTabsContext): ComputerPanelView {
  return computerPanelTabs(context).includes(view) ? view : "computer";
}

const STORAGE_PREFIX = "omb-computer-panel-view";

function storageKey(botId: string): string {
  return `${STORAGE_PREFIX}:${botId}`;
}

export function taskPanelScope(botId: string, threadId?: string): string {
  return threadId ? JSON.stringify([botId, threadId]) : botId;
}

export function readSavedPanelView(scope: string, storage?: Pick<Storage, "getItem">): ComputerPanelView | undefined {
  try {
    const value = (storage ?? localStorage).getItem(storageKey(scope));
    return value === "computer" || value === "android" || value === "browser" || value === "routines" || value === "files" || value === "data" ? value : undefined;
  } catch { return undefined; }
}

export function readComputerPanelView(
  botId: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): ComputerPanelView {
  return readSavedPanelView(botId, storage) ?? "computer";
}

export function writeComputerPanelView(
  botId: string,
  view: ComputerPanelView,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(storageKey(botId), view);
  } catch {
  }
}
