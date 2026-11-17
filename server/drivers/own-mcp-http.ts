// HTTP and stdio transports must enforce the same capability identity and permissions.
import { botBox } from "../bot-box/box.ts";
import { ownMcpOverHttp } from "./turn-mcp.ts";

export const OWN_MCP_HTTP_ENV = "OMB_OWN_MCP_HTTP";

/** OMB_OWN_MCP_HTTP=1 permits URL transport; boxed engines must retain stdio isolation. */
export function ownMcpHttpEnabled(env: NodeJS.ProcessEnv = process.env, boxed: boolean = botBox.enabled()): boolean {
  return !boxed && env[OWN_MCP_HTTP_ENV] === "1";
}

const LOOPBACK = ["127.0.0.1", "localhost", "::1"];

/** HTTP proxy settings can route loopback requests through a proxy unless NO_PROXY/no_proxy excludes those hosts. */
export function withLoopbackNoProxy(env: Record<string, string | undefined>): void {
  const hosts = [env.NO_PROXY, env.no_proxy].flatMap((value) => (value ?? "").split(",")).map((host) => host.trim()).filter(Boolean);
  env.NO_PROXY = env.no_proxy = [...new Set([...hosts, ...LOOPBACK])].join(",");
}

export function loopbackUnproxied(env: Record<string, string | undefined>, http: boolean): boolean {
  if (http) withLoopbackNoProxy(env);
  return http;
}

type StdioMount = { command?: unknown; args?: unknown; env?: unknown; alwaysLoad?: unknown };

/** Claude Code 1.0.60, 2.0.0, 2.1.257 and 2.1.325 support MCP entries with type: "http" and headers. */
export function claudeOwnHttpMount(server: unknown): Record<string, unknown> | null {
  const mount = server as StdioMount | null;
  if (!mount || typeof mount.command !== "string" || !Array.isArray(mount.args) || !mount.env || typeof mount.env !== "object") return null;
  const http = ownMcpOverHttp({ name: "", command: mount.command, args: mount.args.map(String), env: mount.env as Record<string, string> });
  return http ? { type: "http", url: http.url, headers: http.headers, ...(mount.alwaysLoad === true ? { alwaysLoad: true } : {}) } : null;
}

export function claudeOwnMcpOverHttp(servers: Record<string, unknown>, enabled: boolean = ownMcpHttpEnabled()): boolean {
  if (!enabled) return false;
  let converted = false;
  for (const [name, server] of Object.entries(servers)) {
    const http = claudeOwnHttpMount(server);
    if (http) { servers[name] = http; converted = true; }
  }
  return converted;
}

/** ACP permits an http MCP server only when initialize reports agentCapabilities.mcpCapabilities.http. */
const acpHttpAgents = new Set<string>();

export function noteAcpMcpHttp(instanceId: string, init: unknown): void {
  const http = (init as { agentCapabilities?: { mcpCapabilities?: { http?: unknown } } } | null | undefined)?.agentCapabilities?.mcpCapabilities?.http;
  if (http === true) acpHttpAgents.add(instanceId);
  else acpHttpAgents.delete(instanceId);
}

export function acpOwnMcpOverHttp(instanceId: string, fromLaunch: boolean, enabled: boolean = ownMcpHttpEnabled()): boolean {
  return enabled && !fromLaunch && acpHttpAgents.has(instanceId);
}
