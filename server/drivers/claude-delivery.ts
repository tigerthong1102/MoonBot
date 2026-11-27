/** Reconciliation may read its sources and return artifacts through the harness. The CLI confirms this inventory at initialization. */
export const DELIVERY_TOOLS = ["Read", "Grep", "Glob"];
export const DELIVERY_DENIED = ["WebSearch", "Edit", "Write"];
const allowedNative = new Set([...DELIVERY_TOOLS, "ToolSearch", "ReadToolResult"]);
export function deliveryInventoryAllowed(tools: unknown): boolean {
  return Array.isArray(tools) && tools.every(tool => typeof tool === "string" && (
    allowedNative.has(tool) || /^mcp__(agents|ogb|email|composio)__[A-Za-z0-9_-]+$/.test(tool)
  ));
}
