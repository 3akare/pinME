import { DurableObject } from "cloudflare:workers";

/** Hello-world Durable Object: echoes any text frame back (Hibernation API). */
export class EchoDO extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === "string") ws.send(message);
  }

  webSocketClose(ws: WebSocket, code: number): void {
    // 1005/1006 are reserved and cannot be sent in a close frame.
    const safe = code === 1005 || code === 1006 ? 1000 : code;
    ws.close(safe);
  }
}
