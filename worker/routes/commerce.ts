import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, desc, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { carts, cartItems, products, orders, orderItems, deliveries, addresses, stores, markets, productVariants } from "../schema";
import { requireRole, startSession, hashPassword } from "../auth";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { users, type User } from "../schema";
import { cartItemSchema, cartQtySchema, createOrderSchema, addressSchema } from "../../shared/validation";
import { isNull } from "drizzle-orm";
import type { AppEnv, QueueEvent } from "../types";

export const commerce = new Hono<AppEnv>();

const db = (env: Env) => drizzle(env.DB);

const GUEST_COOKIE = "qcart";
const GUEST_TTL = 60 * 60 * 24 * 30;

/**
 * The cart a request belongs to, signed in or not.
 *
 * A visitor gets an ownerless cart whose id lives in a cookie, so they can shop
 * before they have an account — the account is created when they check out.
 * `carts.userId` was already nullable, so this needed no schema change.
 */
async function getCart(c: { env: Env } & any) {
  const d = db(c.env);
  const user = c.get("user") as User | undefined;

  if (user) {
    const [mine] = await d.select().from(carts).where(eq(carts.userId, user.id)).limit(1);
    if (mine) return mine;

    // Signing in mid-shop must not lose the basket: adopt the guest cart.
    const claimed = await claimGuestCart(c, user.id);
    if (claimed) return claimed;

    const [created] = await d.insert(carts).values({ userId: user.id }).returning();
    return created!;
  }

  const guestId = getCookie(c, GUEST_COOKIE);
  if (guestId) {
    const [guest] = await d
      .select()
      .from(carts)
      // `userId IS NULL` matters: once a cart is claimed the stale cookie must
      // not hand a later visitor someone else's basket.
      .where(and(eq(carts.id, guestId), isNull(carts.userId)))
      .limit(1);
    if (guest) return guest;
  }

  const [created] = await d.insert(carts).values({ userId: null }).returning();
  setCookie(c, GUEST_COOKIE, created!.id, {
    httpOnly: true,
    secure: c.env.APP_ENV !== "development",
    sameSite: "Lax",
    path: "/",
    maxAge: GUEST_TTL,
  });
  return created!;
}

/** Attaches an anonymous cart to a user and drops the cookie. Returns it if found. */
export async function claimGuestCart(c: { env: Env } & any, userId: string) {
  const guestId = getCookie(c, GUEST_COOKIE);
  if (!guestId) return null;
  deleteCookie(c, GUEST_COOKIE, { path: "/" });

  const [claimed] = await db(c.env)
    .update(carts)
    .set({ userId })
    .where(and(eq(carts.id, guestId), isNull(carts.userId)))
    .returning();
  return claimed ?? null;
}

async function cartLines(env: Env, cartId: string) {
  // A variant overrides the product's price and stock; a plain product keeps
  // its own. COALESCE does that in SQL so no caller has to branch.
  return db(env)
    .select({
      lineId: cartItems.id,
      productId: products.id,
      variantId: cartItems.variantId,
      variantLabel: productVariants.label,
      storeId: products.storeId,
      name: products.name,
      priceMinor: sql<number>`coalesce(product_variants.price_minor, products.price_minor)`,
      stock: sql<number>`coalesce(product_variants.stock, products.stock)`,
      status: products.status,
      imageKey: products.imageKey,
      qty: cartItems.qty,
      storeName: stores.name,
      marketName: markets.name,
    })
    .from(cartItems)
    .innerJoin(products, eq(products.id, cartItems.productId))
    .innerJoin(stores, eq(stores.id, products.storeId))
    .innerJoin(markets, eq(markets.id, stores.marketId))
    .leftJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .where(eq(cartItems.cartId, cartId));
}

/**
 * Resolves the person behind a guest checkout.
 *
 * An email that already has a password belongs to someone with a real account —
 * silently ordering as them would be an account takeover, so it is refused and
 * they are asked to sign in. An email created by an earlier guest order has no
 * password and is simply reused, so repeat guests keep one order history.
 */
async function findOrCreateGuest(
  c: { env: Env } & any,
  guest: { name: string; email: string; phone?: string; password?: string },
) {
  const d = db(c.env);
  const [existing] = await d.select().from(users).where(eq(users.email, guest.email)).limit(1);

  if (existing) {
    if (existing.passwordHash) {
      throw new HTTPException(409, {
        message: "un compte existe déjà avec cet email — connectez-vous pour commander",
      });
    }
    if (guest.password) {
      // A returning guest who now sets a password claims the account.
      await d
        .update(users)
        .set({ passwordHash: await hashPassword(guest.password), name: guest.name })
        .where(eq(users.id, existing.id));
    }
    return existing;
  }

  // `users.phone` is UNIQUE. Inserting a number that already exists raised a
  // raw constraint error the client saw as an opaque 500 — and every guest who
  // types a phone already on file hits it. Check it like the email above.
  if (guest.phone) {
    const [taken] = await d.select().from(users).where(eq(users.phone, guest.phone)).limit(1);
    if (taken) {
      throw new HTTPException(409, {
        message: "ce numéro est déjà associé à un compte — connectez-vous pour commander",
      });
    }
  }

  const [created] = await d
    .insert(users)
    .values({
      name: guest.name,
      email: guest.email,
      phone: guest.phone ?? null,
      role: "CUSTOMER",
      status: "ACTIVE",
      // No password is fine: the order is what matters, and they can set one
      // later. It just means this account cannot be signed into yet.
      passwordHash: guest.password ? await hashPassword(guest.password) : null,
    })
    .returning();
  return created!;
}

// ---------------------------------------------------------------------- cart

// Carts are deliberately not gated — a visitor shops first and gets an account
// at checkout. Order history and saved addresses still need one.
commerce.use("/orders", async (c, next) => {
  // GET /orders is a signed-in view; POST /orders is the guest checkout.
  if (c.req.method === "GET") return requireRole()(c, next);
  await next();
});
commerce.use("/orders/:id", requireRole());
commerce.use("/addresses", requireRole());

commerce.get("/cart", async (c) => {
  const cart = await getCart(c);
  const lines = await cartLines(c.env, cart.id);
  const subtotalMinor = lines.reduce((sum, l) => sum + l.priceMinor * l.qty, 0);
  return c.json({ cartId: cart.id, lines, subtotalMinor });
});

commerce.post("/cart/items", zValidator("json", cartItemSchema), async (c) => {
  const { productId, variantId, qty } = c.req.valid("json");
  const cart = await getCart(c);
  const d = db(c.env);

  const [product] = await d.select().from(products).where(eq(products.id, productId));
  if (!product || product.status !== "ACTIVE") {
    throw new HTTPException(404, { message: "product unavailable" });
  }

  const known = await d
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  if (known.length && !variantId) {
    throw new HTTPException(400, { message: "choose an option first" });
  }
  if (variantId && !known.some((v) => v.id === variantId)) {
    // Guards against a stale page posting a variant from another product.
    throw new HTTPException(400, { message: "unknown variant for this product" });
  }

  await d
    .insert(cartItems)
    .values({ cartId: cart.id, productId, variantId, qty })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.productId, cartItems.variantId],
      set: { qty: sql`min(${cartItems.qty} + ${qty}, 99)` },
    });

  return c.json({ ok: true }, 201);
});

/**
 * Addresses a cart *line*, not a product — the same product can now appear
 * twice in one cart under different variants. Absolute set, not a delta, so
 * two rapid taps on + cannot race to 3.
 */
commerce.patch("/cart/items/:lineId", zValidator("json", cartQtySchema), async (c) => {
  const { qty } = c.req.valid("json");
  const cart = await getCart(c);
  // Scoping by cartId is the authorisation check: a line id belonging to
  // someone else's cart simply matches nothing.
  const where = and(eq(cartItems.cartId, cart.id), eq(cartItems.id, c.req.param("lineId")));

  if (qty === 0) {
    await db(c.env).delete(cartItems).where(where);
  } else {
    await db(c.env).update(cartItems).set({ qty }).where(where);
  }
  return c.json({ ok: true });
});

commerce.delete("/cart/items/:lineId", async (c) => {
  const cart = await getCart(c);
  await db(c.env)
    .delete(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.id, c.req.param("lineId"))));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ addresses

commerce.get("/addresses", async (c) =>
  c.json({
    addresses: await db(c.env).select().from(addresses).where(eq(addresses.userId, c.get("user")!.id)),
  }),
);

commerce.post("/addresses", zValidator("json", addressSchema), async (c) => {
  const [address] = await db(c.env)
    .insert(addresses)
    .values({ ...c.req.valid("json"), userId: c.get("user")!.id })
    .returning();
  return c.json({ address }, 201);
});

// --------------------------------------------------------------------- orders

/**
 * Checkout.
 *
 * D1 has no interactive transactions, only atomic `batch()`. So stock is taken
 * with guarded decrements (`WHERE stock >= qty`) and we inspect how many rows
 * each one actually changed. If any line lost the race, we compensate by
 * putting the successful decrements back and fail the checkout — the customer
 * sees an honest "out of stock" instead of an oversold order.
 *
 * ponytail: compensation is a best-effort undo, not a real rollback. If the
 * compensating batch itself fails, stock is under-counted until the store
 * corrects it. Move reservations into a per-store Durable Object if oversell
 * pressure ever justifies serialising checkout.
 */
commerce.post("/orders", zValidator("json", createOrderSchema), async (c) => {
  const input = c.req.valid("json");
  const d = db(c.env);
  const cart = await getCart(c);
  const lines = await cartLines(c.env, cart.id);

  // A visitor checking out becomes a customer here — this is the only place an
  // account is created without anyone visiting a sign-up form.
  let user = c.get("user");
  if (!user) {
    if (!input.guest) {
      throw new HTTPException(400, { message: "guest details required" });
    }
    user = await findOrCreateGuest(c, input.guest);
    await d.update(carts).set({ userId: user.id }).where(eq(carts.id, cart.id));
    deleteCookie(c, GUEST_COOKIE, { path: "/" });
    await startSession(c, user.id);
  }

  if (!lines.length) throw new HTTPException(400, { message: "cart is empty" });

  const inactive = lines.filter((l) => l.status !== "ACTIVE");
  if (inactive.length) {
    throw new HTTPException(409, {
      message: `no longer available: ${inactive.map((l) => l.name).join(", ")}`,
    });
  }

  // One order belongs to one store. Mixed carts must be checked out per store.
  const storeIds = [...new Set(lines.map((l) => l.storeId))];
  if (storeIds.length > 1) {
    throw new HTTPException(409, { message: "cart spans multiple stores; check out one store at a time" });
  }
  const storeId = storeIds[0]!;

  const [address] = input.addressId
    ? await d
        .select()
        .from(addresses)
        .where(and(eq(addresses.id, input.addressId), eq(addresses.userId, user.id)))
    : await d
        .insert(addresses)
        .values({ ...input.address!, userId: user.id })
        .returning();
  if (!address) throw new HTTPException(400, { message: "unknown delivery address" });

  // Take stock. Each statement changes 1 row on success, 0 if it lost the race.
  const results = await d.batch(
    lines.map((l) =>
      l.variantId
        ? d
            .update(productVariants)
            .set({ stock: sql`${productVariants.stock} - ${l.qty}` })
            .where(
              and(eq(productVariants.id, l.variantId), sql`${productVariants.stock} >= ${l.qty}`),
            )
        : d
            .update(products)
            .set({ stock: sql`${products.stock} - ${l.qty}` })
            .where(and(eq(products.id, l.productId), sql`${products.stock} >= ${l.qty}`)),
    ) as [any, ...any[]],
  );
  const taken = results.map((r: any) => (r?.meta?.changes ?? r?.rowsAffected ?? 0) > 0);

  if (taken.some((ok) => !ok)) {
    const restore = lines.filter((_, i) => taken[i]);
    if (restore.length) {
      await d.batch(
        restore.map((l) =>
          l.variantId
            ? d
                .update(productVariants)
                .set({ stock: sql`${productVariants.stock} + ${l.qty}` })
                .where(eq(productVariants.id, l.variantId))
            : d
                .update(products)
                .set({ stock: sql`${products.stock} + ${l.qty}` })
                .where(eq(products.id, l.productId)),
        ) as [any, ...any[]],
      );
    }
    const short = lines.filter((_, i) => !taken[i]).map((l) => l.name);
    throw new HTTPException(409, { message: `out of stock: ${short.join(", ")}` });
  }

  const subtotalMinor = lines.reduce((sum, l) => sum + l.priceMinor * l.qty, 0);
  const deliveryFeeMinor = 1500; // 15.00 MAD flat — replace with a zone table later.
  const ref = `Q${Date.now().toString(36).toUpperCase()}`;

  const [order] = await d
    .insert(orders)
    .values({
      ref,
      customerId: user.id,
      storeId,
      addressId: address.id,
      subtotalMinor,
      deliveryFeeMinor,
      totalMinor: subtotalMinor + deliveryFeeMinor,
      paymentMethod: input.paymentMethod,
    })
    .returning();

  await d.batch([
    d.insert(orderItems).values(
      lines.map((l) => ({
        orderId: order!.id,
        productId: l.productId,
        variantId: l.variantId || null,
        name: l.name,
        variantLabel: l.variantLabel ?? null,
        unitPriceMinor: l.priceMinor,
        qty: l.qty,
      })),
    ),
    d.insert(deliveries).values({ orderId: order!.id }),
    d.delete(cartItems).where(eq(cartItems.cartId, cart.id)),
  ]);

  // Notifications, email and analytics are not worth making the customer wait for.
  await c.env.EVENTS.send({
    type: "order.created",
    orderId: order!.id,
    storeId,
    customerId: user.id,
  } satisfies QueueEvent);

  return c.json({ order }, 201);
});

commerce.get("/orders", async (c) => {
  const user = c.get("user")!;
  const rows = await db(c.env)
    .select()
    .from(orders)
    .where(eq(orders.customerId, user.id))
    .orderBy(desc(orders.createdAt))
    .limit(50);
  return c.json({ orders: rows });
});

commerce.get("/orders/:id", async (c) => {
  const user = c.get("user")!;
  const [order] = await db(c.env).select().from(orders).where(eq(orders.id, c.req.param("id")));
  if (!order) throw new HTTPException(404, { message: "order not found" });
  if (order.customerId !== user.id && user.role !== "ADMIN") {
    throw new HTTPException(403, { message: "not your order" });
  }
  const items = await db(c.env).select().from(orderItems).where(eq(orderItems.orderId, order.id));
  return c.json({ order, items });
});
