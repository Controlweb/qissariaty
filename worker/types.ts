import type { User } from "./schema";

export type AppEnv = {
  Bindings: Env;
  Variables: { user?: User };
};

/** Everything the queue consumer knows how to handle. */
export type QueueEvent =
  | { type: "order.created"; orderId: string; storeId: string; customerId: string }
  | { type: "order.status"; orderId: string; status: string }
  | { type: "delivery.assigned"; deliveryId: string; delivererId: string }
  | { type: "delivery.completed"; deliveryId: string; orderId: string };

/** Messages broadcast over the delivery Durable Object socket. */
export type DeliveryEvent =
  | { type: "location"; lat: number; lng: number; heading?: number; at: number }
  | { type: "status"; status: string; at: number }
  | { type: "snapshot"; status: string | null; location: { lat: number; lng: number } | null };
