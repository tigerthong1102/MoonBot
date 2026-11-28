import { browserRecord } from "@/lib/browser-records";
import { ApiError, apiFetch } from "@/state/api";
import { readSessionState } from "@/lib/session";
import type { Index } from "./source-index";

export async function libraryOwner(fetchImpl?: typeof fetch, reportOffline = false) {
  const session = await readSessionState(fetchImpl);
  if (reportOffline && session.kind === "unreachable") {
    if (session.code) throw new ApiError(session.error, 503, { code: session.code });
    throw new TypeError("Source server unreachable");
  }
  if (session.kind === "session") return session.id;
  if (session.kind === "loopback" && session.trust !== "service") return "local";
  return null;
}

export async function libraryKey(threadId: string, options?: { reportOffline?: boolean; background?: boolean; signal?: AbortSignal }) {
  try {
    const owner = await libraryOwner(options?.background
      ? (input, init) => apiFetch(input, { ...init, background: true, signal: options.signal, timeoutMs: 30_000 })
      : options?.signal ? (input, init) => apiFetch(input, { ...init, signal: options.signal, timeoutMs: 30_000 }) : undefined,
    options?.reportOffline);
    if (!owner) return null;
    const response = await apiFetch(`/api/threads/${encodeURIComponent(threadId)}/knowledge-access`, {
      credentials: "same-origin", cache: "no-store", background: options?.background, signal: options?.signal, timeoutMs: 30_000,
    });
    if ([401, 403].includes(response.status)) return null;
    if (response.status === 404) {
      const body = await response.json().catch(() => ({}));
      if (body?.code === "knowledge_thread_unavailable") return null;
      throw new ApiError("Source access check unavailable", 404, { code: "source_access_unavailable" });
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError("Source server unavailable", response.status, body);
    }
    const value: unknown = await response.json();
    const confirmed = (value && typeof value === "object" && "owner" in value) ? value.owner : undefined;
    return confirmed === owner ? JSON.stringify([owner, threadId]) : null;
  } catch (error) {
    if (options?.reportOffline) throw error;
    return null;
  }
}

export function readLibrary(key: string): Promise<Index | undefined> {
  return browserRecord("readonly", store => store.get(key));
}

export { sourceLink } from "../../../shared/source-evidence";

export function parseSourceLink(href: string) {
  const match = /^#startupbot-source-([0-9a-f]{64})-(\d{1,9})(?:\/([^\s#]{1,16384}))?$/.exec(href);
  if (!match) return null;
  try { return { digest: match[1]!, start: Number(match[2]), ...(match[3] ? { path: decodeURIComponent(match[3]) } : {}) }; }
  catch { return null; }
}
