import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  users,
  stores,
  markets,
  products,
  orders,
  orderItems,
  passwordResets,
} from "../schema";
import { requireRole } from "../auth";
import {
  storeUpdateSchema,
  profileUpdateSchema,
  marketUpdateSchema,
  marketCreateSchema,
} from "../../shared/validation";
import { releaseMedia } from "../media-gc";
import { slugify } from "../slug";
import { issueResetToken } from "./auth";
import type { AppEnv, QueueEvent } from "../types";

export const manage = new Hono<AppEnv>();

const db = (env: Env) => drizzle(env.DB);

// ---------------------------------------------------------------- store owner

manage.use("/me/stores", requireRole("STORE_OWNER", "ADMIN"));
manage.use("/stores/:id", requireRole("STORE_OWNER", "ADMIN"));
manage.use("/stores/:id/orders", requireRole("STORE_OWNER", "ADMIN"));
manage.use("/stores/:id/kpis", requireRole("STORE_OWNER", "ADMIN"));
manage.use("/orders/:id/status", requireRole("STORE_OWNER", "ADMIN"));

/** The seller dashboard's entry point: which shops does this account run? */
/** A merchant edits their own shop — including its logo. */
manage.patch(
  "/stores/:id",
  requireRole("STORE_OWNER", "ADMIN"),
  zValidator("json", storeUpdateSchema),
  async (c) => {
    const store = await assertOwnsStore(c, c.req.param("id"));
    const patch = c.req.valid("json");
    const [updated] = await db(c.env)
      .update(stores)
      .set(patch)
      .where(eq(stores.id, store.id))
      .returning();

    // Only when the caller actually addressed the logo — an unrelated patch
    // must not be read as "clear the image".
    if ("logoKey" in patch) releaseMedia(c, store.logoKey, patch.logoKey);
    return c.json({ store: updated });
  },
);

/** Anyone signed in may change their own name, phone and picture. */
manage.patch("/me", requireRole(), zValidator("json", profileUpdateSchema), async (c) => {
  const user = c.get("user")!;
  const patch = c.req.valid("json");
  const [updated] = await db(c.env)
    .update(users)
    // Deliberately narrow: role and status are not in the schema, so this
    // endpoint can never be used to self-promote.
    .set(c.req.valid("json"))
    .where(eq(users.id, user.id))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      avatarKey: users.avatarKey,
      phone: users.phone,
    });

  if ("avatarKey" in patch) releaseMedia(c, user.avatarKey, patch.avatarKey);
  return c.json({ user: updated });
});

manage.get("/me/stores", async (c) => {
  const user = c.get("user")!;
  const rows = await db(c.env)
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      status: stores.status,
      marketId: stores.marketId,
      marketName: markets.name,
      logoKey: stores.logoKey,
      description: stores.description,
      phone: stores.phone,
      category: stores.category,
    })
    .from(stores)
    .innerJoin(markets, eq(markets.id, stores.marketId))
    .where(user.role === "ADMIN" ? undefined : eq(stores.ownerId, user.id));
  return c.json({ stores: rows });
});

async function assertOwnsStore(c: any, storeId: string) {
  const user = c.get("user")!;
  const [store] = await db(c.env).select().from(stores).where(eq(stores.id, storeId));
  if (!store) throw new HTTPException(404, { message: "store not found" });
  if (user.role !== "ADMIN" && store.ownerId !== user.id) {
    throw new HTTPException(403, { message: "not your store" });
  }
  return store;
}

manage.get("/stores/:id/kpis", async (c) => {
  const store = await assertOwnsStore(c, c.req.param("id"));
  const d = db(c.env);

  const [[revenue], [productCount]] = await Promise.all([
    d
      .select({
        orderCount: sql<number>`count(*)`,
        // Cancelled orders are not revenue; SUM over an empty set is NULL.
        revenueMinor: sql<number>`coalesce(sum(case when status != 'CANCELLED' then total_minor else 0 end), 0)`,
      })
      .from(orders)
      .where(eq(orders.storeId, store.id)),
    d
      .select({ n: sql<number>`count(*)` })
      .from(products)
      .where(and(eq(products.storeId, store.id), eq(products.status, "ACTIVE"))),
  ]);

  return c.json({
    orderCount: revenue?.orderCount ?? 0,
    revenueMinor: revenue?.revenueMinor ?? 0,
    productCount: productCount?.n ?? 0,
  });
});

manage.get("/stores/:id/orders", async (c) => {
  const store = await assertOwnsStore(c, c.req.param("id"));
  const rows = await db(c.env)
    .select({
      id: orders.id,
      ref: orders.ref,
      status: orders.status,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      createdAt: orders.createdAt,
      customerName: users.name,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.customerId))
    .where(eq(orders.storeId, store.id))
    .orderBy(desc(orders.createdAt))
    .limit(100);

  // One extra query beats N: fetch every line for the page's orders at once.
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db(c.env).select().from(orderItems).where(inArray(orderItems.orderId, ids))
    : [];

  return c.json({
    orders: rows.map((o) => ({ ...o, items: items.filter((i) => i.orderId === o.id) })),
  });
});

const statusSchema = z.object({
  status: z.enum(["CONFIRMED", "PREPARING", "READY", "CANCELLED"]),
});

manage.patch("/orders/:id/status", zValidator("json", statusSchema), async (c) => {
  const [order] = await db(c.env).select().from(orders).where(eq(orders.id, c.req.param("id")));
  if (!order) throw new HTTPException(404, { message: "order not found" });
  await assertOwnsStore(c, order.storeId);

  const { status } = c.req.valid("json");
  await db(c.env).update(orders).set({ status }).where(eq(orders.id, order.id));
  await c.env.EVENTS.send({ type: "order.status", orderId: order.id, status } satisfies QueueEvent);

  return c.json({ ok: true });
});

// --------------------------------------------------------------------- admin

manage.use("/admin/*", requireRole("ADMIN"));

manage.get("/admin/kpis", async (c) => {
  const d = db(c.env);
  const [[u], [s], [m], [o]] = await Promise.all([
    d.select({ n: sql<number>`count(*)` }).from(users),
    d.select({ n: sql<number>`count(*)` }).from(stores),
    d.select({ n: sql<number>`count(*)` }).from(markets),
    d
      .select({
        n: sql<number>`count(*)`,
        gmvMinor: sql<number>`coalesce(sum(case when status != 'CANCELLED' then total_minor else 0 end), 0)`,
      })
      .from(orders),
  ]);
  return c.json({
    users: u?.n ?? 0,
    stores: s?.n ?? 0,
    markets: m?.n ?? 0,
    orders: o?.n ?? 0,
    gmvMinor: o?.gmvMinor ?? 0,
  });
});

/** Moderation queue — shops waiting to be let onto the platform. */
manage.get("/admin/pending", async (c) => {
  const rows = await db(c.env)
    .select({
      id: stores.id,
      name: stores.name,
      createdAt: stores.createdAt,
      marketName: markets.name,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(stores)
    .innerJoin(markets, eq(markets.id, stores.marketId))
    .innerJoin(users, eq(users.id, stores.ownerId))
    .where(eq(stores.status, "PENDING"))
    .orderBy(desc(stores.createdAt));
  return c.json({ stores: rows });
});

manage.post("/admin/stores/:id/approve", async (c) => {
  await db(c.env).update(stores).set({ status: "ACTIVE" }).where(eq(stores.id, c.req.param("id")));
  return c.json({ ok: true });
});

manage.post("/admin/stores/:id/reject", async (c) => {
  await db(c.env).update(stores).set({ status: "CLOSED" }).where(eq(stores.id, c.req.param("id")));
  return c.json({ ok: true });
});

manage.get("/admin/users", async (c) => {
  const rows = await db(c.env)
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(200);
  return c.json({ users: rows });
});

/** Activates a pending seller or deliverer, or suspends any account. */
manage.post("/admin/users/:id/status", zValidator("json", z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
})), async (c) => {
  const { status } = c.req.valid("json");
  await db(c.env).update(users).set({ status }).where(eq(users.id, c.req.param("id")));
  return c.json({ ok: true });
});

manage.patch(
  "/admin/markets/:id",
  zValidator("json", marketUpdateSchema),
  async (c) => {
    const patch = c.req.valid("json");
    const [before] = await db(c.env)
      .select({ coverKey: markets.coverKey })
      .from(markets)
      .where(eq(markets.id, c.req.param("id")));

    const [updated] = await db(c.env)
      .update(markets)
      .set(patch)
      .where(eq(markets.id, c.req.param("id")))
      .returning();
    if (!updated) throw new HTTPException(404, { message: "market not found" });

    if ("coverKey" in patch) releaseMedia(c, before?.coverKey, patch.coverKey);
    return c.json({ market: updated });
  },
);

manage.get("/admin/markets", async (c) => {
  const rows = await db(c.env)
    .select({
      id: markets.id,
      slug: markets.slug,
      name: markets.name,
      nameAr: markets.nameAr,
      city: markets.city,
      description: markets.description,
      lat: markets.lat,
      lng: markets.lng,
      status: markets.status,
      coverKey: markets.coverKey,
      storeCount: sql<number>`(select count(*) from stores s where s.market_id = markets.id)`,
    })
    .from(markets)
    .orderBy(desc(markets.createdAt));
  return c.json({ markets: rows });
});

/**
 * Create a souk. Nothing in the worker inserted into `markets` before this, so
 * the only markets that existed were the ones in seed.sql — a merchant could
 * propose one and an admin could approve it, with no way to then bring it into
 * being.
 */
manage.post("/admin/markets", zValidator("json", marketCreateSchema), async (c) => {
  const input = c.req.valid("json");
  const d = db(c.env);

  // `slug` is NOT NULL UNIQUE; a duplicate would surface as an opaque 500.
  const base = slugify(input.name) || "marche";
  const [taken] = await d.select({ slug: markets.slug }).from(markets).where(eq(markets.slug, base));
  const slug = taken ? `${base}-${Date.now().toString(36).slice(-4)}` : base;

  const [created] = await d
    .insert(markets)
    .values({ ...input, slug })
    .returning();
  return c.json({ market: created }, 201);
});

/**
 * Issue a one-time password-reset link for a user.
 *
 * This Worker has no email binding, so self-service "forgot password" cannot
 * send anything. An admin generates the link here and passes it on by phone or
 * WhatsApp — which is how support recovery works in practice anyway. The raw
 * token is returned exactly once and never stored.
 */
manage.post("/admin/users/:id/reset-link", async (c) => {
  const d = db(c.env);
  const [user] = await d.select().from(users).where(eq(users.id, c.req.param("id")));
  if (!user) throw new HTTPException(404, { message: "user not found" });

  const { token, expiresAt } = await issueResetToken(c.env, user.id);

  return c.json({ url: new URL(`/reinitialiser?token=${token}`, c.req.url).toString(), expiresAt });
});

// ------------------------------------------------------------------- products

/** The merchant's own catalogue — every status, including drafts and archives. */
manage.get("/stores/:id/catalogue", requireRole("STORE_OWNER", "ADMIN"), async (c) => {
  const store = await assertOwnsStore(c, c.req.param("id"));
  const rows = await db(c.env)
    .select()
    .from(products)
    .where(eq(products.storeId, store.id))
    .orderBy(desc(products.createdAt))
    .limit(200);
  return c.json({
    products: rows.map((p) => ({
      ...p,
      imageUrl: p.imageKey ? `${c.env.MEDIA_PUBLIC_BASE}/${p.imageKey}` : null,
    })),
  });
});
