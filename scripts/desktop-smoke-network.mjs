import assert from "node:assert/strict";

/** Summarize Chromium HTTP(S) requests in an isolated macOS package smoke. Never retain query strings or paths. */
export function desktopSmokeNetwork(netLog) {
  const start = netLog.constants.logEventTypes.URL_REQUEST_START_JOB;
  const hosts = new Map();
  let faviconRequests = 0;
  for (const event of netLog.events) {
    if (event.type !== start || !event.params?.url) continue;
    const url = new URL(event.params.url);
    if (!["https:", "http:"].includes(url.protocol)) continue;
    hosts.set(url.hostname, (hosts.get(url.hostname) ?? 0) + 1);
    if ((url.hostname === "www.google.com" && url.pathname === "/s2/favicons") ||
        (url.hostname.endsWith(".gstatic.com") && url.pathname === "/faviconV2")) faviconRequests++;
  }
  assert(hosts.has("127.0.0.1"), "No renderer requests to the isolated server were captured");
  return { hosts: Object.fromEntries([...hosts].sort(([a], [b]) => a.localeCompare(b))), faviconRequests };
}
