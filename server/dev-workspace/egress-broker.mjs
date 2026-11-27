// Runs in a separate Linux container with no access to the task's files.
export async function startEgressBroker() {
  const { createServer } = await import("node:http");
  const { get } = await import("node:https");
  const { resolve4 } = await import("node:dns/promises");
  const { chmodSync } = await import("node:fs");
  const { BlockList } = await import("node:net");
  const blocked = new BlockList();
  for (const [base, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]]) {
    blocked.addSubnet(base, bits, "ipv4");
  }
  const allowed = new Set(JSON.parse(process.env.APPROVED_HOSTS));
  const socket = "/run/egress/fetch.sock";
  const timeoutMs = 10000;
  const server = createServer(async (request, response) => {
    let host = "(invalid)";
    const end = (status, body) => {
      console.log(JSON.stringify({ at: new Date().toISOString(), host, status }));
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { "content-type": "application/octet-stream", "cache-control": "no-store" });
      response.end(body);
    };
    try {
      const local = new URL(request.url, "http://localhost");
      if (request.method !== "GET" || local.pathname !== "/fetch") return end(405, "Use GET /fetch?url=...");
      const target = new URL(local.searchParams.get("url"));
      host = target.hostname;
      if (target.protocol !== "https:" || target.port || target.username || target.password || !allowed.has(host)) return end(403, "Destination is outside the task allowlist");
      const addresses = await resolve4(host);
      if (!addresses.length || addresses.some(ip => blocked.check(ip, "ipv4"))) return end(403, "Destination has no permitted public address");
      const upstream = get(target, { family: 4, agent: false, signal: AbortSignal.timeout(timeoutMs),
        lookup: (_hostname, _options, callback) => callback(null, addresses[0], 4) }, incoming => {
        if (incoming.statusCode !== 200) { incoming.destroy(); return end(502, "Upstream refused or redirected the request"); }
        let bytes = 0;
        const chunks = [];
        incoming.on("data", chunk => {
          bytes += chunk.length;
          if (bytes > 8 * 1024 * 1024) { end(413, "Response exceeds 8 MiB"); incoming.destroy(); }
          else chunks.push(chunk);
        });
        incoming.on("error", () => { if (!response.writableEnded) end(502, "Upstream response failed"); });
        incoming.on("end", () => end(200, Buffer.concat(chunks)));
      });
      upstream.on("error", () => { if (!response.writableEnded) end(502, "Upstream request failed"); });
      response.on("close", () => upstream.destroy());
    } catch { end(400, "Invalid or unreachable destination"); }
  });
  server.maxConnections = 8;
  server.headersTimeout = timeoutMs;
  server.listen(socket, () => chmodSync(socket, 0o666));
  setTimeout(() => server.close(() => process.exit()), Number(process.env.TASK_MINUTES) * 60000);
}
