import type { ConfigStatus } from "@/state/config-status";
import { isOwnerOrAdmin, type SessionState } from "./session";
import { pageIsThisComputer } from "./companion-bridge";

export function aiTwinAvailable(config: ConfigStatus | null | undefined, session: SessionState | null): boolean {
  if (config?.features?.aiTwin !== true || config.team) return false;
  return config.cloudHome ? session?.kind === "session" && isOwnerOrAdmin(session) : pageIsThisComputer();
}
