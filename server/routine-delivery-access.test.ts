import { describe, expect, it } from "vitest";
import { saveReconciliationBytes } from "./routine-deliverables.ts";
import type { HandoffView } from "./coordinator.ts";
import { confineDeliveryIntegrations, deliveryRouteAllowed, internalDeliveryTurn, isDeliveryConnectorRead } from "./routine-delivery-access.ts";

const call = (name: string, args = {}) => ({ method: "tools/call", params: { name, arguments: args } });
const multi = (...slugs: string[]) => call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: slugs.map(tool_slug => ({ tool_slug, arguments: {} })) });

describe("reconciliation external delivery policy", () => {
  it("exposes only the internal attachment and read paths, including with Full bot privileges", () => {
    const mounts = { agents: {}, hooks: {}, email: {}, composio: {}, custom: {}, computer: {}, browser: {}, data: {} };
    confineDeliveryIntegrations(mounts);
    expect(Object.keys(mounts)).toEqual(["agents", "hooks", "email", "composio"]);
    expect(deliveryRouteAllowed("POST", "/api/internal/attach-file")).toBe(true);
    expect(deliveryRouteAllowed("POST", "/api/internal/connectors/mcp")).toBe(true);
    for (const path of ["/api/internal/computer-control", "/api/internal/coordinate-bots", "/api/internal/pages", "/api/internal/future-service"]) {
      expect(deliveryRouteAllowed("POST", path)).toBe(false);
    }
  });
  it("rejects an unlisted artifact, mismatched MIME, malformed encoding, and oversized inline bytes", async () => {
    for (const [name, path] of [
      ["another.pdf", "data:application/pdf;base64,QQ=="], ["report.pdf", "data:text/csv;base64,QQ=="],
      ["sources.csv", "data:text/csv;base64,QQ==oops"], ["sources.csv", "data:text/csv;base64," + "A".repeat(350_000)],
      ["sources.csv", "an-existing-path"],
    ]) await expect(saveReconciliationBytes(path!, name)).rejects.toMatchObject({ status: 400 });
  });
  it("allows connector metadata and known reads, rejecting mixed writes before relay", () => {
    for (const frame of [{ method: "tools/list" }, call("COMPOSIO_SEARCH_TOOLS"), call("GMAIL_FETCH_EMAILS"), multi("GMAIL_FETCH_EMAILS", "GOOGLECALENDAR_EVENTS_LIST")]) {
      expect(isDeliveryConnectorRead(frame)).toBe(true);
    }
    for (const frame of [call("GMAIL_SEND_EMAIL"), call("GMAIL_CREATE_EMAIL_DRAFT"), call("COMPOSIO_REMOTE_WORKBENCH"),
      call("COMPOSIO_MANAGE_CONNECTIONS"), call("GMAIL_FETCH_EMAILS", { attachments: ["/inside/report.pdf"] }), multi("GMAIL_FETCH_EMAILS", "SLACK_SEND_MESSAGE"), multi(), [call("GMAIL_SEND_EMAIL")]]) {
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
    const queued = { ...child, id: "job", status: "queued" } as HandoffView;
    const dispatching = { inThread: () => [], node: (id: string) => id === "job" ? queued : root };
    expect(internalDeliveryTurn(child, run, dispatching, "job")).toBe(true);
    expect(internalDeliveryTurn({ botId: "other", threadId: "worker" }, run, dispatching, "job")).toBe(false);
    expect(internalDeliveryTurn(child, () => null, coordinator)).toBe(false);
  });
});
