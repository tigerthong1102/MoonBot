import { DurableObject } from "cloudflare:workers";
import type { InboxEnv } from "./personal-inbox-worker";

export class InboxSignals extends DurableObject<InboxEnv> {
  async fetch(req: Request) {
    if (req.headers.get("upgrade") !== "websocket") return new Response(null, { status: 426 });
    if (this.ctx.getWebSockets().length >= 16) return new Response(null, { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: req.headers.get("x-session"), expires: Number(req.headers.get("x-expires")) });
    return new Response(null, { status: 101, webSocket: client });
  }

  async notify() {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    const sessions = sockets.map((socket) => socket.deserializeAttachment() as { id: string; expires: number });
    const { results } = await this.env.DB.prepare(
      "SELECT id FROM session WHERE id IN (" + sessions.map(() => "?").join(",") + ")",
    ).bind(...sessions.map((s) => s.id)).all<{id: string}>();
    const valid = new Set(results.map((r) => r.id));
    sockets.forEach((socket, i) => {
      const session = sessions[i];
      if (socket.readyState !== WebSocket.OPEN) return;
      if (valid.has(session.id) && session.expires > Date.now()) socket.send("changed");
      else socket.close(1008, "Session expired");
    });
  }

  webSocketMessage(socket: WebSocket) { socket.close(1008, "Receive only"); }
  webSocketClose(socket: WebSocket) { socket.close(); }
}

export async function notifyRoom(env: InboxEnv, room: string) {
  if (!env.SIGNALS) return;
  const { results } = await env.DB.prepare("SELECT person FROM inbox_members WHERE room=? AND state='active'")
    .bind(room).all<{person: string}>();
  await Promise.all(results.map(({ person }) => env.SIGNALS!.getByName(person).notify()));
}
