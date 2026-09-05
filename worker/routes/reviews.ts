import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  reviews,
  users,
  products,
  productOptions,
  productVariants,
  orders,
  orderItems,
  stores,
} from "../schema";
import { requireRole } from "../auth";
import { reviewSchema, variantsSchema } from "../../shared/validation";
import type { AppEnv } from "../types";

export const extras = new Hono<AppEnv>();

const db = (env: Env) => drizzle(env.DB);

// -------------------------------------------------------------------- reviews

/** Rating summary plus the latest reviews, for a store or a product. */
async function listReviews(
  env: Env,
  column: typeof reviews.storeId | typeof reviews.productId,
  id: string,
) {
  const d = db(env);
  const [rows, [agg]] = await Promise.all([
    d
      .select({
        id: reviews.id,
        rating: reviews.rating,
        body: reviews.body,
        createdAt: reviews.createdAt,
        author: users.name,
      })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(eq(column, id))
      .orderBy(desc(reviews.createdAt))
      .limit(50),
    d
      .select({
        count: sql<number>`count(*)`,
        // ROUND to one decimal in SQL so every client shows the same number.
        average: sql<number>`coalesce(round(avg(rating), 1), 0)`,
      })
      .from(reviews)
      .where(eq(column, id)),
  ]);
  return { reviews: rows, count: agg?.count ?? 0, average: agg?.average ?? 0 };
}

extras.get("/stores/:id/reviews", async (c) =>
  c.json(await listReviews(c.env, reviews.storeId, c.req.param("id"))),
);

extras.get("/products/:id/reviews", async (c) =>
  c.json(await listReviews(c.env, reviews.productId, c.req.param("id"))),
);

/**
 * Only a customer who actually received the thing may review it, and only once.
 * Without that check a review section is just an anonymous comment box.
 */
extras.post("/reviews", requireRole(), zValidator("json", reviewSchema), async (c) => {
  const user = c.get("user")!;
  const input = c.req.valid("json");
  const d = db(c.env);

  const delivered = input.productId
    ? await d
        .select({ id: orders.id })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(
          and(
            eq(orders.customerId, user.id),
            eq(orders.status, "DELIVERED"),
            eq(orderItems.productId, input.productId),
          ),
        )
        .limit(1)
    : await d
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.customerId, user.id),
            eq(orders.status, "DELIVERED"),
            eq(orders.storeId, input.storeId!),
          ),
        )
        .limit(1);

  if (!delivered.length) {
    throw new HTTPException(403, { message: "only delivered orders can be reviewed" });
  }

  const already = await d
    .select({ id: reviews.id })
    .from(reviews)
    .where(
      and(
        eq(reviews.userId, user.id),
        input.productId
          ? eq(reviews.productId, input.productId)
          : eq(reviews.storeId, input.storeId!),
      ),
    )
    .limit(1);
  if (already.length) throw new HTTPException(409, { message: "already reviewed" });

  const [review] = await d
    .insert(reviews)
    .values({
      userId: user.id,
      rating: input.rating,
      body: input.body ?? null,
      storeId: input.storeId ?? null,
      productId: input.productId ?? null,
    })
    .returning();

  return c.json({ review }, 201);
});

// ------------------------------------------------------------------- variants

extras.get("/products/:id/variants", async (c) => {
  const productId = c.req.param("id");
  const d = db(c.env);
  const [options, variants] = await Promise.all([
    d.select().from(productOptions).where(eq(productOptions.productId, productId)),
    d.select().from(productVariants).where(eq(productVariants.productId, productId)),
  ]);
  return c.json({ options: options.sort((a, b) => a.position - b.position), variants });
});

/**
 * Replace-all rather than patch: the option axes and the combinations they
 * generate must stay consistent, and a half-applied edit would leave variants
 * referencing options that no longer exist.
 */
extras.put(
  "/products/:id/variants",
  requireRole("STORE_OWNER", "ADMIN"),
  zValidator("json", variantsSchema),
  async (c) => {
    const productId = c.req.param("id");
    const d = db(c.env);

    const [product] = await d.select().from(products).where(eq(products.id, productId));
    if (!product) throw new HTTPException(404, { message: "product not found" });
    await assertOwns(c, product.storeId);

    const { options, variants } = c.req.valid("json");

    // Every variant must name exactly the declared axes, or the picker breaks.
    const axes = options.map((o) => o.name).sort();
    for (const v of variants) {
      const keys = Object.keys(v.options).sort();
      if (keys.length !== axes.length || keys.some((k, i) => k !== axes[i])) {
        throw new HTTPException(400, {
          message: `variant options must be exactly: ${axes.join(", ")}`,
        });
      }
    }

    await d.batch([
      d.delete(productVariants).where(eq(productVariants.productId, productId)),
      d.delete(productOptions).where(eq(productOptions.productId, productId)),
    ]);

    if (options.length) {
      await d.insert(productOptions).values(
        options.map((o, i) => ({ productId, name: o.name, values: o.values, position: i })),
      );
    }
    if (variants.length) {
      await d.insert(productVariants).values(
        variants.map((v) => ({
          productId,
          options: v.options,
          label: axes.map((a) => v.options[a]).join(" · "),
          sku: v.sku ?? null,
          priceMinor: v.priceMinor,
          stock: v.stock,
        })),
      );
    }

    // The product's own stock becomes the sum of its variants, so listing
    // pages and the "out of stock" badge stay truthful without special cases.
    if (variants.length) {
      await d
        .update(products)
        .set({
          stock: variants.reduce((n, v) => n + v.stock, 0),
          priceMinor: Math.min(...variants.map((v) => v.priceMinor)),
        })
        .where(eq(products.id, productId));
    }

    return c.json({ ok: true });
  },
);

async function assertOwns(c: any, storeId: string) {
  const user = c.get("user")!;
  if (user.role === "ADMIN") return;
  const [store] = await db(c.env).select().from(stores).where(eq(stores.id, storeId));
  if (!store || store.ownerId !== user.id) {
    throw new HTTPException(403, { message: "not your store" });
  }
}

/** Batch rating lookup so a product grid does not fire one request per card. */
extras.get("/ratings", async (c) => {
  const ids = (c.req.query("stores") ?? "").split(",").filter(Boolean).slice(0, 50);
  if (!ids.length) return c.json({ ratings: {} });

  const rows = await db(c.env)
    .select({
      storeId: reviews.storeId,
      count: sql<number>`count(*)`,
      average: sql<number>`coalesce(round(avg(rating), 1), 0)`,
    })
    .from(reviews)
    .where(inArray(reviews.storeId, ids))
    .groupBy(reviews.storeId);

  const ratings: Record<string, { count: number; average: number }> = {};
  for (const r of rows) {
    if (r.storeId) ratings[r.storeId] = { count: r.count, average: r.average };
  }
  return c.json({ ratings });
});
