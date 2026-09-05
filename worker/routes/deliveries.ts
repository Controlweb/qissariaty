import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull, desc } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { deliveries, orders, stores, markets, addresses, users } from "../schema";
import { requireRole } from "../auth";
import {
  delivererLocationSchema,
  deliveredSchema,
  availableDeliveriesQuerySchema,
} from "../../shared/validation";
import { releaseMedia } from "../media-gc";
import type { AppEnv, QueueEvent } from "../types";

export const delivery = new Hono<AppEnv>();

const db = (env: Env) => drizzle(env.DB);
const room = (env: Env, deliveryId: string) => env.DELIVERY.get(env.DELIVERY.idFromName(deliveryId));

/** Live tracking socket. Anyone with the delivery id can watch its progress. */
delivery.get("/deliveries/:id/socket", async (c) => {
  const [row] = await db(c.env).select().from(deliveries).where(eq(deliveries.id, c.req.param("id")));
  if (!row) throw new HTTPException(404, { message: "delivery not found" });
  return room(c.env, row.id).fetch(c.req.raw);
});

// ------------------------------------------------------------------ deliverer

delivery.use("/deliveries/available", requireRole("DELIVERER", "ADMIN"));
delivery.use("/deliveries/mine", requireRole("DELIVERER", "ADMIN"));
delivery.use("/deliveries/:id/accept", requireRole("DELIVERER", "ADMIN"));
delivery.use("/deliveries/:id/picked-up", requireRole("DELIVERER", "ADMIN"));
delivery.use("/deliveries/:id/delivered", requireRole("DELIVERER", "ADMIN"));
delivery.use("/deliveries/:id/location", requireRole("DELIVERER", "ADMIN"));

/**
 * The job board: enough to decide whether to take the run — where to collect,
 * which part of town it goes to, how far, and what it pays.
 *
 * The exact street and the customer's phone are deliberately NOT here. An
 * unclaimed job is visible to every courier on the platform, and handing all of
 * them a customer's doorstep is not a trade any of those customers agreed to.
 * Both arrive on /deliveries/mine once the run is actually claimed.
 */
delivery.get("/deliveries/available", zValidator("query", availableDeliveriesQuerySchema), async (c) => {
  const { city, limit } = c.req.valid("query");
  const rows = await db(c.env)
    .select({
      id: deliveries.id,
      createdAt: deliveries.createdAt,
      orderRef: orders.ref,
      totalMinor: orders.totalMinor,
      feeMinor: orders.deliveryFeeMinor,
      storeName: stores.name,
      marketName: markets.name,
      city: markets.city,
      lat: markets.lat,
      lng: markets.lng,
      dropCity: addresses.city,
      dropLat: addresses.lat,
      dropLng: addresses.lng,
    })
    .from(deliveries)
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .innerJoin(stores, eq(stores.id, orders.storeId))
    .innerJoin(markets, eq(markets.id, stores.marketId))
    .leftJoin(addresses, eq(addresses.id, orders.addressId))
    .where(
      and(
        eq(deliveries.status, "UNASSIGNED"),
        isNull(deliveries.delivererId),
        city ? eq(markets.city, city) : undefined,
      ),
    )
    .orderBy(desc(deliveries.createdAt))
    .limit(limit);
  return c.json({ deliveries: rows });
});

/** A claimed run, with everything needed to actually complete it. */
delivery.get("/deliveries/mine", async (c) => {
  const rows = await db(c.env)
    .select({
      id: deliveries.id,
      status: deliveries.status,
      proofKey: deliveries.proofKey,
      createdAt: deliveries.createdAt,
      orderRef: orders.ref,
      totalMinor: orders.totalMinor,
      feeMinor: orders.deliveryFeeMinor,
      // Collect here.
      storeName: stores.name,
      storePhone: stores.phone,
      marketName: markets.name,
      lat: markets.lat,
      lng: markets.lng,
      // Deliver here.
      customerName: users.name,
      customerPhone: users.phone,
      dropLine1: addresses.line1,
      dropCity: addresses.city,
      dropLat: addresses.lat,
      dropLng: addresses.lng,
      dropNotes: addresses.notes,
    })
    .from(deliveries)
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .innerJoin(stores, eq(stores.id, orders.storeId))
    .innerJoin(markets, eq(markets.id, stores.marketId))
    .innerJoin(users, eq(users.id, orders.customerId))
    .leftJoin(addresses, eq(addresses.id, orders.addressId))
    .where(eq(deliveries.delivererId, c.get("user")!.id))
    .orderBy(desc(deliveries.createdAt))
    .limit(50);
  return c.json({ deliveries: rows });
});

/**
 * Claim a delivery. The `status = UNASSIGNED` predicate is the lock: two
 * deliverers tapping accept at the same moment, only one update changes a row.
 */
delivery.post("/deliveries/:id/accept", async (c) => {
  const user = c.get("user")!;
  const [claimed] = await db(c.env)
    .update(deliveries)
    .set({ delivererId: user.id, status: "ASSIGNED", acceptedAt: Math.floor(Date.now() / 1000) })
    .where(and(eq(deliveries.id, c.req.param("id")), eq(deliveries.status, "UNASSIGNED")))
    .returning();

  if (!claimed) throw new HTTPException(409, { message: "already taken" });

  await db(c.env).update(orders).set({ status: "IN_TRANSIT" }).where(eq(orders.id, claimed.orderId));
  await room(c.env, claimed.id).publishStatus("ASSIGNED");
  await c.env.EVENTS.send({
    type: "delivery.assigned",
    deliveryId: claimed.id,
    delivererId: user.id,
  } satisfies QueueEvent);

  return c.json({ delivery: claimed });
});

/** Load the delivery and confirm it belongs to the calling deliverer. */
async function assertAssigned(c: any, id: string) {
  const user = c.get("user")!;
  const [row] = await db(c.env).select().from(deliveries).where(eq(deliveries.id, id));
  if (!row) throw new HTTPException(404, { message: "delivery not found" });
  if (user.role !== "ADMIN" && row.delivererId !== user.id) {
    throw new HTTPException(403, { message: "not your delivery" });
  }
  return row;
}

delivery.post("/deliveries/:id/picked-up", async (c) => {
  const row = await assertAssigned(c, c.req.param("id"));
  await db(c.env).update(deliveries).set({ status: "PICKED_UP" }).where(eq(deliveries.id, row.id));
  await room(c.env, row.id).publishStatus("PICKED_UP");
  return c.json({ ok: true });
});

delivery.post(
  "/deliveries/:id/delivered",
  // The photo is optional: a courier with a dead camera must still be able to
  // close the job rather than leaving it stuck in transit.
  zValidator("json", deliveredSchema.optional().default({})),
  async (c) => {
  const row = await assertAssigned(c, c.req.param("id"));
  const now = Math.floor(Date.now() / 1000);
  const { proofKey } = c.req.valid("json") ?? {};

  await db(c.env).batch([
    db(c.env)
      .update(deliveries)
      .set({ status: "DELIVERED", deliveredAt: now, proofKey: proofKey ?? null })
      .where(eq(deliveries.id, row.id)),
    db(c.env).update(orders).set({ status: "DELIVERED" }).where(eq(orders.id, row.orderId)),
  ]);

  // A courier who retakes the photo leaves the first one orphaned.
  if (proofKey !== undefined) releaseMedia(c, row.proofKey, proofKey);

  await room(c.env, row.id).publishStatus("DELIVERED");
  await c.env.EVENTS.send({
    type: "delivery.completed",
    deliveryId: row.id,
    orderId: row.orderId,
  } satisfies QueueEvent);

  return c.json({ ok: true });
  },
);

/**
 * Location ping. Goes straight to the Durable Object — writing every GPS
 * sample to D1 would be pure write amplification for data nobody reads twice.
 */
delivery.post("/deliveries/:id/location", zValidator("json", delivererLocationSchema), async (c) => {
  const row = await assertAssigned(c, c.req.param("id"));
  const { lat, lng, heading } = c.req.valid("json");
  const { throttled } = await room(c.env, row.id).publishLocation(lat, lng, heading);
  // 200 even when throttled: the client should back off, not retry harder.
  return c.json({ ok: true, throttled });
});
