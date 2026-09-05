import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, like, like as like_, gte, lte, sql, desc } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { markets, stores, products, categories } from "../schema";
import { requireRole } from "../auth";
import {
  boundsSchema,
  marketQuerySchema,
  storeSchema,
  productSchema,
  productUpdateSchema,
  searchSchema,
} from "../../shared/validation";
import { releaseMedia } from "../media-gc";
import { cachedJson } from "../scale";
import type { AppEnv } from "../types";

export const catalog = new Hono<AppEnv>();

const db = (env: Env) => drizzle(env.DB);
const mediaUrl = (env: Env, key: string | null) => (key ? `${env.MEDIA_PUBLIC_BASE}/${key}` : null);

/**
 * Map viewport query. The whole point of the bounding box is that we never
 * ship every market in Morocco to the browser — the map asks only for what is
 * on screen, and `boundsSchema` refuses viewports wider than 2 degrees.
 */
catalog.get("/markets/bounds", zValidator("query", boundsSchema), async (c) => {
  const b = c.req.valid("query");
  // P0 scale: map pans hammer this endpoint. Public data, cache 60s at edge.
  return cachedJson(c.req.raw, c, 60, async () => {
    const rows = await db(c.env)
      .select({
        id: markets.id,
        slug: markets.slug,
        name: markets.name,
        city: markets.city,
        lat: markets.lat,
        lng: markets.lng,
        coverKey: markets.coverKey,
        // Written out by hand: interpolating `${markets.id}` here renders the
        // bare identifier "id", which the subquery resolves against `stores`
        // (which also has an `id`), silently counting zero. Alias the inner
        // table and qualify the outer column explicitly.
        // TODO(P1): replace with markets.store_count denormalized column.
        storeCount: sql<number>`(select count(*) from stores s where s.market_id = markets.id and s.status = 'ACTIVE')`,
      })
      .from(markets)
      .where(
        and(
          eq(markets.status, "ACTIVE"),
          gte(markets.lat, b.south),
          lte(markets.lat, b.north),
          gte(markets.lng, b.west),
          lte(markets.lng, b.east),
        ),
      )
      .limit(b.limit);

    return {
      markets: rows.map((m) => ({ ...m, coverUrl: mediaUrl(c.env, m.coverKey) })),
    };
  });
});

catalog.get("/markets", zValidator("query", marketQuerySchema), async (c) => {
  const { city, q, limit, offset } = c.req.valid("query");
  return cachedJson(c.req.raw, c, 60, async () => {
    const rows = await db(c.env)
      .select()
      .from(markets)
      .where(
        and(
          eq(markets.status, "ACTIVE"),
          city ? eq(markets.city, city) : undefined,
          q ? like(markets.name, `%${q}%`) : undefined,
        ),
      )
      .limit(limit)
      .offset(offset);

    return { markets: rows.map((m) => ({ ...m, coverUrl: mediaUrl(c.env, m.coverKey) })) };
  });
});

catalog.get("/markets/:id", async (c) => {
  return cachedJson(c.req.raw, c, 60, async () => {
    const [market] = await db(c.env).select().from(markets).where(eq(markets.id, c.req.param("id")));
    if (!market) throw new HTTPException(404, { message: "market not found" });
    return { market: { ...market, coverUrl: mediaUrl(c.env, market.coverKey) } };
  });
});

catalog.get("/markets/:id/stores", async (c) => {
  const rows = await db(c.env)
    .select()
    .from(stores)
    .where(and(eq(stores.marketId, c.req.param("id")), eq(stores.status, "ACTIVE")));
  return c.json({ stores: rows.map((s) => ({ ...s, logoUrl: mediaUrl(c.env, s.logoKey) })) });
});

catalog.get("/stores/:id", async (c) => {
  const [store] = await db(c.env).select().from(stores).where(eq(stores.id, c.req.param("id")));
  if (!store) throw new HTTPException(404, { message: "store not found" });
  return c.json({ store: { ...store, logoUrl: mediaUrl(c.env, store.logoKey) } });
});

catalog.get("/stores/:id/products", async (c) => {
  return cachedJson(c.req.raw, c, 60, async () => {
    const rows = await db(c.env)
      .select()
      .from(products)
      .where(and(eq(products.storeId, c.req.param("id")), eq(products.status, "ACTIVE")))
      .orderBy(desc(products.createdAt))
      .limit(100);
    return { products: rows.map((p) => ({ ...p, imageUrl: mediaUrl(c.env, p.imageKey) })) };
  });
});

catalog.get("/products/:id", async (c) => {
  const [product] = await db(c.env).select().from(products).where(eq(products.id, c.req.param("id")));
  if (!product) throw new HTTPException(404, { message: "product not found" });
  return c.json({ product: { ...product, imageUrl: mediaUrl(c.env, product.imageKey) } });
});

/**
 * Cross-entity search backing the design's grouped results page. Three small
 * indexed LIKE queries beat one UNION here: D1 can use each table's own index,
 * and the page renders them as separate sections anyway.
 */
catalog.get("/search", zValidator("query", searchSchema), async (c) => {
  const { q, limit } = c.req.valid("query");
  const d = db(c.env);
  const like = `%${q}%`;

  const [foundMarkets, foundStores, foundProducts] = await Promise.all([
    d.select().from(markets).where(and(eq(markets.status, "ACTIVE"), like_(markets.name, like))).limit(limit),
    d.select().from(stores).where(and(eq(stores.status, "ACTIVE"), like_(stores.name, like))).limit(limit),
    d
      .select({
        id: products.id,
        name: products.name,
        priceMinor: products.priceMinor,
        currency: products.currency,
        imageKey: products.imageKey,
        storeName: stores.name,
      })
      .from(products)
      .innerJoin(stores, eq(stores.id, products.storeId))
      .where(and(eq(products.status, "ACTIVE"), like_(products.name, like)))
      .limit(limit),
  ]);

  return c.json({
    markets: foundMarkets.map((m) => ({ ...m, coverUrl: mediaUrl(c.env, m.coverKey) })),
    stores: foundStores.map((s) => ({ ...s, logoUrl: mediaUrl(c.env, s.logoKey) })),
    products: foundProducts.map((p) => ({ ...p, imageUrl: mediaUrl(c.env, p.imageKey) })),
    total: foundMarkets.length + foundStores.length + foundProducts.length,
  });
});

catalog.get("/categories", async (c) =>
  cachedJson(c.req.raw, c, 300, async () => ({
    categories: await db(c.env).select().from(categories),
  })),
);

// ---------------------------------------------------------------- store owner

catalog.post("/stores", requireRole("STORE_OWNER", "ADMIN"), zValidator("json", storeSchema), async (c) => {
  const input = c.req.valid("json");
  const [store] = await db(c.env)
    .insert(stores)
    .values({ ...input, ownerId: c.get("user")!.id })
    .returning();
  return c.json({ store }, 201);
});

/** Ownership check shared by every store-owner mutation below. */
async function assertOwnsStore(c: any, storeId: string) {
  const user = c.get("user")!;
  const [store] = await db(c.env).select().from(stores).where(eq(stores.id, storeId));
  if (!store) throw new HTTPException(404, { message: "store not found" });
  if (user.role !== "ADMIN" && store.ownerId !== user.id) {
    throw new HTTPException(403, { message: "not your store" });
  }
  return store;
}

catalog.post(
  "/stores/:id/products",
  requireRole("STORE_OWNER", "ADMIN"),
  zValidator("json", productSchema),
  async (c) => {
    const store = await assertOwnsStore(c, c.req.param("id"));
    const [product] = await db(c.env)
      .insert(products)
      .values({ ...c.req.valid("json"), storeId: store.id })
      .returning();
    return c.json({ product }, 201);
  },
);

catalog.patch(
  "/products/:id",
  requireRole("STORE_OWNER", "ADMIN"),
  // productUpdateSchema, not productSchema.partial(): clearing a photo or a
  // description means sending null, which the stricter create schema rejects.
  zValidator("json", productUpdateSchema),
  async (c) => {
    const [existing] = await db(c.env).select().from(products).where(eq(products.id, c.req.param("id")));
    if (!existing) throw new HTTPException(404, { message: "product not found" });
    await assertOwnsStore(c, existing.storeId);

    const patch = c.req.valid("json");
    const [product] = await db(c.env)
      .update(products)
      .set(patch)
      .where(eq(products.id, existing.id))
      .returning();

    if ("imageKey" in patch) releaseMedia(c, existing.imageKey, patch.imageKey);
    return c.json({ product });
  },
);

catalog.delete("/products/:id", requireRole("STORE_OWNER", "ADMIN"), async (c) => {
  const [existing] = await db(c.env).select().from(products).where(eq(products.id, c.req.param("id")));
  if (!existing) throw new HTTPException(404, { message: "product not found" });
  await assertOwnsStore(c, existing.storeId);

  // Archive rather than delete: order_items still reference this row.
  await db(c.env).update(products).set({ status: "ARCHIVED" }).where(eq(products.id, existing.id));
  return c.json({ ok: true });
});
