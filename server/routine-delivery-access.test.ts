import { describe, expect, it } from "vitest";
import type { HandoffView } from "./coordinator.ts";
import { internalDeliveryTurn, isDeliveryConnectorRead } from "./routine-delivery-access.ts";

const call = (name: string, args = {}) => ({ method: "tools/call", params: { name, arguments: args } });
const multi = (...slugs: string[]) => call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: slugs.map(tool_slug => ({ tool_slug, arguments: {} })) });

describe("reconciliation external delivery policy", () => {
  it("allows connector metadata and known reads, rejecting mixed writes before relay", () => {
    for (const frame of [{ method: "tools/list" }, call("COMPOSIO_SEARCH_TOOLS"), call("GMAIL_FETCH_EMAILS"), multi("GMAIL_FETCH_EMAILS", "GOOGLECALENDAR_EVENTS_LIST")]) {
      expect(isDeliveryConnectorRead(frame)).toBe(true);
    }
    for (const frame of [call("GMAIL_SEND_EMAIL"), call("GMAIL_CREATE_EMAIL_DRAFT"), call("COMPOSIO_REMOTE_WORKBENCH"),
      call("COMPOSIO_MANAGE_CONNECTIONS"), multi("GMAIL_FETCH_EMAILS", "SLACK_SEND_MESSAGE"), multi(), [call("GMAIL_SEND_EMAIL")]]) {
      expect(isDeliveryConnectorRead(frame)).toBe(false);
    }
  });

  it("inherits only the active contracted worker assignment and leaves the results chat available for a later send", () => {
    const root = { botId: "finance", threadId: "execution" } as HandoffView;
    const child = { parentId: "root", rootId: "root", status: "running", botId: "helper", threadId: "worker" } as HandoffView;
    const coordinator = { inThread: (thread: string) => thread === "worker" ? [child] : [], node: () => root };
    const run = (id: string) => id === "execution" ? { botId: "finance", deliverables: "reconciliation" as const } : null;
    expect(internalDeliveryTurn(root, run, coordinator)).toBe(true);
    expect(internalDeliveryTurn(child, run, coordinator)).toBe(true);
    expect(internalDeliveryTurn({ botId: "other", threadId: "worker" }, run, coordinator)).toBe(false);
    expect(internalDeliveryTurn({ botId: "finance", threadId: "results" }, run, coordinator)).toBe(false);
    expect(internalDeliveryTurn(child, () => null, coordinator)).toBe(false);
  });
});
