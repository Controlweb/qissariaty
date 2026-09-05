import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { markets, stores, products, users, orders, deliveries } from "../worker/schema";
import { hashPassword } from "../worker/auth";

const db = () => drizzle(env.DB);
const PW = "correct-horse-battery";

const post = (body: unknown, cookie?: string, key?: string) => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
    ...(key ? { "Idempotency-Key": key } : {}),
  },
  body: JSON.stringify(body),
});

async function customer() {
  const email = `cust-${crypto.randomUUID()}@x.ma`;
  await db()
    .insert(users)
    .values({ name: "Cust", email, role: "CUSTOMER", status: "ACTIVE", passwordHash: await hashPassword(PW) });
  const res = await SELF.fetch("https://x/api/auth/login", post({ email, password: PW }));
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

async function shopWithStock(stock: number) {
  const d = db();
  const [market] = await d
    .insert(markets)
    .values({ slug: `m-${crypto.randomUUID()}`, name: "Souk", city: "Casablanca", lat: 33.5, lng: -7.6 })
    .returning();
  const [owner] = await d
    .insert(users)
    .values({ name: "O", email: `o-${crypto.randomUUID()}@x.ma`, role: "STORE_OWNER", status: "ACTIVE" })
    .returning();
  const [store] = await d
    .insert(stores)
    .values({ marketId: market!.id, ownerId: owner!.id, slug: `s-${crypto.randomUUID()}`, name: "B", status: "ACTIVE" })
    .returning();
  const [product] = await d
    .insert(products)
    .values({ storeId: store!.id, name: "P", priceMinor: 10000, stock, status: "ACTIVE" })
    .returning();
  return product!;
}

async function addressFor(cookie: string) {
  const res = await SELF.fetch(
    "https://x/api/addresses",
    post({ line1: "1 Rue", city: "Casablanca", lat: 33.5, lng: -7.6 }, cookie),
  );
  return ((await res.json()) as { address: { id: string } }).address.id;
}

describe("checkout idempotency", () => {
  it("a sequential retry with the same key does not take stock twice", async () => {
    const cookie = await customer();
    const product = await shopWithStock(10);
    const addressId = await addressFor(cookie);
    await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 3 }, cookie));

    const key = crypto.randomUUID();
    const first = await SELF.fetch("https://x/api/orders", post({ addressId }, cookie, key));
    expect(first.status).toBe(201);

    // The client retries the same attempt (double tap, or a network retry).
    const second = await SELF.fetch("https://x/api/orders", post({ addressId }, cookie, key));
    expect(second.status).toBe(200);
    expect((await second.json() as { deduped?: boolean }).deduped).toBe(true);

    const [after] = await db().select().from(products).where(eq(products.id, product.id));
    // 10 - 3, exactly once.
    expect(after!.stock).toBe(7);
  });

  it("two concurrent requests sharing a key leave stock and the order consistent", async () => {
    const cookie = await customer();
    const product = await shopWithStock(10);
    const addressId = await addressFor(cookie);
    await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 3 }, cookie));

    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      SELF.fetch("https://x/api/orders", post({ addressId }, cookie, key)),
      SELF.fetch("https://x/api/orders", post({ addressId }, cookie, key)),
    ]);

    const rows = await db().select().from(orders).where(eq(orders.idempotencyKey, key));
    expect(rows).toHaveLength(1);

    // Exactly one delivery for that order, not two.
    const dels = await db().select().from(deliveries).where(eq(deliveries.orderId, rows[0]!.id));
    expect(dels).toHaveLength(1);

    // Neither caller should see a 5xx: one order was created, and that is a
    // success from both callers' point of view.
    expect([a.status, b.status].filter((s) => s >= 500)).toHaveLength(0);

    // And the whole point: stock is taken once, not once per racing request.
    const [after] = await db().select().from(products).where(eq(products.id, product.id));
    expect(after!.stock).toBe(7);
  });
});

describe("idempotency key scope", () => {
  it("a key already used by someone else must not burn the second customer's stock", async () => {
    const product = await shopWithStock(10);

    // Customer A places a normal order with key K.
    const a = await customer();
    const addrA = await addressFor(a);
    await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 2 }, a));
    const key = crypto.randomUUID();
    expect((await SELF.fetch("https://x/api/orders", post({ addressId: addrA }, a, key))).status).toBe(201);

    const [afterA] = await db().select().from(products).where(eq(products.id, product.id));
    expect(afterA!.stock).toBe(8);

    // Customer B sends the same key. The dedup lookup is scoped to B, so it
    // finds nothing and the request proceeds to take stock — but the UNIQUE
    // constraint on orders.idempotency_key is global, so the insert then
    // fails and the recovery lookup (also scoped to B) finds no winner.
    const b = await customer();
    const addrB = await addressFor(b);
    await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 3 }, b));
    const res = await SELF.fetch("https://x/api/orders", post({ addressId: addrB }, b, key));

    const [afterB] = await db().select().from(products).where(eq(products.id, product.id));

    // Whatever the response, stock must not be consumed by an order that was
    // never created. This is the assertion that fails today.
    const ordersForB = await db().select().from(orders).where(eq(orders.idempotencyKey, key));
    if (ordersForB.length === 1 && res.status >= 400) {
      expect(afterB!.stock, "stock consumed by a failed order").toBe(8);
    }
  });
});
