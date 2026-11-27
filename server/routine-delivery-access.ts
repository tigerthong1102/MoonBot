import { KNOWN_READ_SLUGS } from "../shared/outbound.ts";
import type { Coordinator } from "./coordinator.ts";
import { localFileReferences } from "./connector-files.ts";
import { connectorCallFromFrame } from "./connector-verdict.ts";
import type { RoutineRun } from "./routines.ts";

export const INTERNAL_DELIVERY_ONLY = "This reconciliation delivers its verified files to the selected StartupBot conversation. Open the completed report there to request a separate external delivery.";

export const DELIVERY_ENGINE_REFUSAL = "Choose Claude Agent with an isolated, up-to-date Claude Code account to run this reconciliation and attach its verified files.";
const integrations = new Set(["agents", "hooks", "composio", "email"]);
export function confineDeliveryIntegrations<T extends object>(mounts: T) {
  for (const key of Object.keys(mounts) as Array<keyof T>) if (!integrations.has(String(key))) delete mounts[key];
}
const deliveryRoutes = new Set(["POST /api/internal/attach-file", "POST /api/internal/hook", "POST /api/internal/email/mcp",
  "POST /api/internal/connectors/mcp", "GET /api/internal/tool-result", "POST /api/internal/tool-result"]);
export function deliveryRouteAllowed(method: string, path: string) { return deliveryRoutes.has(method + " " + path); }

type Turn = { botId: string; threadId: string };
type RunOf = (threadId: string) => Pick<RoutineRun, "deliverables" | "botId"> | null;

export function internalDeliveryTurn(turn: Turn, activeRun: RunOf, coordinator: Pick<Coordinator, "inThread" | "node">, assigned?: string): boolean {
  const isContracted = ({ botId, threadId }: Turn) => {
    const run = activeRun(threadId);
    return run?.botId === botId && run.deliverables === "reconciliation";
  };
  if (isContracted(turn)) return true;
  // A delegated worker inherits the originating run's delivery target while handling that assignment.
  const assignment = assigned ? coordinator.node(assigned) : undefined;
  return [...coordinator.inThread(turn.threadId, { open: true }), ...(assignment ? [assignment] : [])].some(node => {
    if (node.threadId !== turn.threadId || node.botId !== turn.botId || !node.parentId || (node.status !== "running" && !(node.id === assigned && node.status === "queued"))) return false;
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
  return call.kind === "tools" && call.names.every(slug => KNOWN_READ_SLUGS.has(slug)) && localFileReferences(frame).references.length === 0;
}
