import { DurableObject } from "cloudflare:workers";
import type { DeliveryEvent } from "./types";

/**
 * One instance per delivery. Holds the live sockets for the customer, the
 * store and the deliverer, and the last known position.
 *
 * Location pings are high-frequency and worthless once superseded, so they live
 * here (in DO storage) rather than in D1. Only durable milestones — accepted,
 * picked up, delivered — are written back to D1 by the route handlers.
 */
export class DeliveryRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json(await this.snapshot());
    }

    const pair = new WebSocketPair();
    // Hibernation: the DO can be evicted between messages and the socket
    // survives, so an idle delivery costs nothing.
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify(await this.snapshot()));

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private async snapshot(): Promise<DeliveryEvent> {
    const [status, location] = await Promise.all([
      this.ctx.storage.get<string>("status"),
      this.ctx.storage.get<{ lat: number; lng: number }>("location"),
    ]);
    return { type: "snapshot", status: status ?? null, location: location ?? null };
  }

  /**
   * Called over the DO stub by the deliverer's location ping route.
   *
   * P0 scale guard: GPS pings are high-frequency. The location is always
   * stored (cheap, superseded), but broadcasts to watchers are throttled to
   * one per 3s so a chatty client cannot fan out into a WS flood.
   */
  async publishLocation(lat: number, lng: number, heading?: number): Promise<{ throttled: boolean }> {
    const now = Date.now();
    const last = (await this.ctx.storage.get<number>("lastBroadcastAt")) ?? 0;
    await this.ctx.storage.put("location", { lat, lng });
    if (now - last < 3000) return { throttled: true };
    await this.ctx.storage.put("lastBroadcastAt", now);
    this.broadcast({ type: "location", lat, lng, heading, at: now });
    return { throttled: false };
  }

  /** Called over the DO stub when a delivery milestone is written to D1. */
  async publishStatus(status: string) {
    await this.ctx.storage.put("status", status);
    this.broadcast({ type: "status", status, at: Date.now() });
    if (status === "DELIVERED" || status === "FAILED") {
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, "delivery closed");
      await this.ctx.storage.deleteAll();
    }
  }

  private broadcast(event: DeliveryEvent) {
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // A dead socket must not stop the others from being notified.
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number) {
    ws.close(code, "closing");
  }
}
