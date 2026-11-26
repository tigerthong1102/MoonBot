import type { ConfigStatus } from "@/state/config-status";
import { pageIsThisComputer } from "./companion-bridge";

export function localAiTwinAvailable(config: ConfigStatus | null | undefined): boolean {
  return config?.features?.aiTwin === true && !config.cloudHome && !config.team && pageIsThisComputer();
}
