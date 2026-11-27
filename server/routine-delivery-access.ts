import { KNOWN_READ_SLUGS } from "../shared/outbound.ts";
import type { Coordinator } from "./coordinator.ts";
import { connectorCallFromFrame } from "./connector-verdict.ts";
import type { RoutineRun } from "./routines.ts";

export const INTERNAL_DELIVERY_ONLY = "This reconciliation delivers its verified files to the selected StartupBot conversation. Open the completed report there to request a separate external delivery.";

type Turn = { botId: string; threadId: string };
type RunOf = (threadId: string) => Pick<RoutineRun, "deliverables" | "botId"> | null;

export function internalDeliveryTurn(turn: Turn, activeRun: RunOf, coordinator: Pick<Coordinator, "inThread" | "node">): boolean {
  const isContracted = ({ botId, threadId }: Turn) => {
    const run = activeRun(threadId);
    return run?.botId === botId && run.deliverables === "reconciliation";
  };
  if (isContracted(turn)) return true;
  // A delegated worker inherits the originating run's delivery target while handling that assignment.
  return coordinator.inThread(turn.threadId, { open: true }).some(node => {
    if (node.botId !== turn.botId || !node.parentId || node.status !== "running") return false;
    const root = coordinator.node(node.rootId);
    return root !== undefined && isContracted(root);
  });
}

const protocolReads = new Set(["initialize", "ping", "tools/list", "notifications/initialized", "notifications/cancelled"]);
const discovery = new Set(["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS"]);

/** Opaque, malformed, mixed and unknown calls cannot modify an external service on behalf of this contract. */
export function isDeliveryConnectorRead(frame: unknown): boolean {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return false;
  const { method, params } = frame as { method?: unknown; params?: { name?: unknown } };
  if (typeof method === "string" && protocolReads.has(method)) return true;
  if (method !== "tools/call") return false;
  if (typeof params?.name === "string" && discovery.has(params.name)) return true;
  const call = connectorCallFromFrame(frame);
  return call.kind === "tools" && call.names.every(slug => KNOWN_READ_SLUGS.has(slug));
}
