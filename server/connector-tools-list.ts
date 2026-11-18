// An engine reads a connector's tools/list once, when its session starts: a list that fails then leaves the whole
// session without connected-app tools. So each backend's last good list stands in for a failed or rate-limited one.

/** Return an exact reply, or an error-only diagnostic when the server could not identify the request. */
export function parseMcpResponse(text: string, id: unknown): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidate = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value) &&
    "id" in value && value.id !== null && value.id === id && !("method" in value) && ("result" in value || "error" in value);
  const diagnostic = (value: unknown): Record<string, unknown> | null => {
    if (value === null || typeof value !== "object" || Array.isArray(value) || !("id" in value) || value.id !== null || "method" in value) return null;
    const error = "error" in value ? value.error : undefined;
    if (error === null || typeof error !== "object" || Array.isArray(error) || !("message" in error) || typeof error.message !== "string") return null;
    // This is deliberately not a correlated response: it has no id or result to consume or cache.
    return { error };
  };
  if (trimmed.startsWith("{")) {
    const parsed: unknown = JSON.parse(trimmed);
    return candidate(parsed) ? parsed : diagnostic(parsed);
  }
  const frames = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
  return frames.filter(candidate).at(-1) ?? frames.map(diagnostic).filter((frame) => frame !== null).at(-1) ?? null;
}

const MAX_CACHED_CONTINUATIONS = 32;
type CatalogPage = { tools: unknown[]; nextCursor?: string };
type CatalogCache = { firstPageOrder?: number; pages: Map<string | undefined, CatalogPage> };

const lastToolsLists = new Map<string, CatalogCache>();
let nextDiscoveryOrder = 0;

function toolsListId(payload: unknown): { id: string | number; cursor: string | undefined } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const frame = payload as { jsonrpc?: unknown; method?: unknown; id?: unknown; params?: unknown };
  if (frame.jsonrpc !== "2.0" || frame.method !== "tools/list") return null;
  if (typeof frame.id !== "string" && (typeof frame.id !== "number" || !Number.isFinite(frame.id))) return null;
  if (frame.params !== undefined && (!frame.params || typeof frame.params !== "object" || Array.isArray(frame.params))) return null;
  const cursor = (frame.params as { cursor?: unknown } | undefined)?.cursor;
  if (cursor !== undefined && typeof cursor !== "string") return null;
  return { id: frame.id, cursor };
}

function toolsResult(text: string, id: string | number): CatalogPage | undefined {
  try {
    const frame = parseMcpResponse(text, id);
    if (!frame || frame.jsonrpc !== "2.0" || frame.id !== id || "error" in frame) return undefined;
    const result = frame.result;
    if (!result || typeof result !== "object" || !("tools" in result) || !Array.isArray(result.tools)) return undefined;
    if ("nextCursor" in result && typeof result.nextCursor !== "string") return undefined;
    return result as CatalogPage;
  } catch {
    return undefined;
  }
}

function remembersCursor(cache: CatalogCache, cursor: string): boolean {
  return cache.firstPageOrder === undefined || cache.pages.has(cursor) ||
    [...cache.pages.values()].some((page) => page.nextCursor === cursor);
}

/** `backend` names the endpoint and credential, so one backend's list is never served for another. */
export async function withToolsListFallback(
  backend: string,
  payload: unknown,
  send: () => Promise<Response>,
): Promise<Response> {
  const request = toolsListId(payload);
  if (!request) return send();
  const discoveryOrder = request.cursor === undefined ? ++nextDiscoveryOrder : undefined;
  const cacheAtStart = lastToolsLists.get(backend);
  const fallback = () => {
    if (lastToolsLists.get(backend) !== cacheAtStart) return undefined;
    const cached = cacheAtStart?.pages.get(request.cursor);
    return cached === undefined ? undefined : Response.json({ jsonrpc: "2.0", id: request.id, result: cached });
  };
  let response: Response;
  try {
    response = await send();
  } catch (error) {
    const cachedResponse = fallback();
    if (cachedResponse) return cachedResponse;
    throw error;
  }
  if (response.ok) {
    const result = toolsResult(await response.clone().text(), request.id);
    if (result !== undefined) {
      const cache = lastToolsLists.get(backend);
      if (discoveryOrder !== undefined) {
        if (discoveryOrder > (cache?.firstPageOrder ?? 0)) {
          lastToolsLists.set(backend, { firstPageOrder: discoveryOrder, pages: new Map([[undefined, result]]) });
        }
      } else if (request.cursor !== undefined && (cache === cacheAtStart || (!cacheAtStart && cache?.firstPageOrder === undefined))) {
        const current: CatalogCache = cache ?? { pages: new Map() };
        if (remembersCursor(current, request.cursor)) {
          current.pages.set(request.cursor, result);
          if (current.pages.size > MAX_CACHED_CONTINUATIONS + Number(current.pages.has(undefined))) {
            const oldest = [...current.pages.keys()].find((cursor) => cursor !== undefined);
            current.pages.delete(oldest);
          }
          lastToolsLists.set(backend, current);
        }
      }
    }
  } else if (response.status >= 500 || response.status === 429) {
    const cachedResponse = fallback();
    if (cachedResponse) {
      await response.body?.cancel();
      return cachedResponse;
    }
  }
  return response;
}
