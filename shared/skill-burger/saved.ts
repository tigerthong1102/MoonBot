import type { LayerKind } from "./layers.ts";

export interface SavedWorkflowLayer {
  kind: LayerKind;
  app?: string;
  label: string;
  id?: string;
  /** A decide step's cases. */
  cases?: string[];
  /** The case of a decide step this step belongs to. */
  on?: { decide: string; case: string };
}
export interface SavedWorkflow {
  name: string;
  summary: string;
  sha256: string;
  savedAt: string;
  layers: SavedWorkflowLayer[];
  args: string[];
  everyChat: boolean;
  /** The bot it was made with; unknown for one whose bot is gone. */
  botId?: string;
}

export const burgerSource = (botId: string) => `skill-burger:${botId}`;
export function burgerBotOf(source: string): string | undefined {
  return source.startsWith("skill-burger:") ? source.slice("skill-burger:".length) || undefined : undefined;
}
export const isBurgerSource = (source: string | undefined) => Boolean(source?.startsWith("skill-burger"));
