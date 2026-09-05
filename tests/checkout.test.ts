import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { markets, stores, products, users } from "../worker/schema";
import { hashPassword } from "../worker/auth";

const db = () => drizzle(env.DB);
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Registers a customer and returns the session cookie for subsequent calls. */
async function signIn(email: string) {
  const res = await SELF.fetch(
    "https://x/api/auth/register",
    json({ name: "Test Client", email, password: "correct-horse-battery" }),
  );
  expect(res.status).toBe(201);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

async function seedProduct(stock: number, priceMinor = 4900) {
  const d = db();
  const [owner] = await d
    .insert(users)
    .values({
      name: "Owner",
      email: `owner-${crypto.randomUUID()}@x.ma`,
      role: "STORE_OWNER",
      passwordHash: await hashPassword("x".repeat(12)),
    })
    .returning();
  const [market] = await d
    .insert(markets)
    .values({ slug: `m-${crypto.randomUUID()}`, name: "Qissaria Test", city: "Casablanca", lat: 33.57, lng: -7.59 })
    .returning();
  const [store] = await d
    .insert(stores)
    .values({
      marketId: market!.id,
      ownerId: owner!.id,
      slug: `s-${crypto.randomUUID()}`,
      name: "Boutique Test",
      status: "ACTIVE",
    })
    .returning();
  const [product] = await d
    .insert(products)
    .values({ storeId: store!.id, name: "Babouches", priceMinor, stock, status: "ACTIVE" })
    .returning();
  return { store: store!, product: product! };
}

async function addAddress(cookie: string) {
  const res = await SELF.fetch("https://x/api/addresses", {
    ...json({ line1: "12 Rue Test", city: "Casablanca", lat: 33.57, lng: -7.59 }),
    headers: { "content-type": "application/json", cookie },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { address: { id: string } }).address.id;
}

describe("checkout", () => {
  let cookie: string;

  beforeEach(async () => {
    cookie = await signIn(`c-${crypto.randomUUID()}@x.ma`);
  });

  it("places an order, takes stock and empties the cart", async () => {
    const { product } = await seedProduct(5);
    const addressId = await addAddress(cookie);

    await SELF.fetch("https://x/api/cart/items", {
      ...json({ productId: product.id, qty: 2 }),
      headers: { "content-type": "application/json", cookie },
    });

    const res = await SELF.fetch("https://x/api/orders", {
      ...json({ addressId }),
      headers: { "content-type": "application/json", cookie },
    });
    expect(res.status).toBe(201);

    const { order } = (await res.json()) as { order: { subtotalMinor: number; totalMinor: number } };
    expect(order.subtotalMinor).toBe(9800); // 2 x 49.00 MAD, in centimes
    expect(order.totalMinor).toBe(9800 + 1500);

    const [after] = await db().select().from(products).where(eq(products.id, product.id));
    expect(after!.stock).toBe(3);

    const cart = (await (
      await SELF.fetch("https://x/api/cart", { headers: { cookie } })
    ).json()) as { lines: unknown[] };
    expect(cart.lines).toHaveLength(0);
  });

  it("refuses to oversell and leaves stock untouched", async () => {
    const { product } = await seedProduct(1);
    const addressId = await addAddress(cookie);

    await SELF.fetch("https://x/api/cart/items", {
      ...json({ productId: product.id, qty: 3 }),
      headers: { "content-type": "application/json", cookie },
    });

    const res = await SELF.fetch("https://x/api/orders", {
      ...json({ addressId }),
      headers: { "content-type": "application/json", cookie },
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({ error: /out of stock/ as never });

    const [after] = await db().select().from(products).where(eq(products.id, product.id));
    expect(after!.stock).toBe(1);
  });

  it("rejects a viewport wider than the bounds guard allows", async () => {
    const wide = await SELF.fetch(
      "https://x/api/markets/bounds?north=36&south=27&east=-1&west=-13",
    );
    expect(wide.status).toBe(400);
  });

  it("returns only markets inside the viewport, with a live store count", async () => {
    await seedProduct(1);
    const inside = await SELF.fetch(
      "https://x/api/markets/bounds?north=33.6&south=33.5&east=-7.5&west=-7.7",
    );
    const { markets: found } = (await inside.json()) as {
      markets: { storeCount: number }[];
    };
    expect(found.length).toBeGreaterThan(0);
    // Guards the correlated subquery: an unqualified `id` inside it resolves
    // against `stores`, not `markets`, and silently counts zero.
    expect(found.every((m) => m.storeCount === 1)).toBe(true);

    const elsewhere = await SELF.fetch(
      "https://x/api/markets/bounds?north=31.7&south=31.6&east=-7.9&west=-8.1",
    );
    expect(((await elsewhere.json()) as { markets: unknown[] }).markets).toHaveLength(0);
  });
});
