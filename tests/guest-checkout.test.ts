import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { markets, stores, products, users, carts, orders } from "../worker/schema";
import { hashPassword } from "../worker/auth";

const db = () => drizzle(env.DB);

const post = (body: unknown, cookie?: string) => ({
  method: "POST",
  headers: cookie
    ? { "content-type": "application/json", cookie }
    : { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Every Set-Cookie value on a response, joined for the next request. */
const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

async function seedProduct(stock = 5) {
  const d = db();
  const [owner] = await d
    .insert(users)
    .values({ name: "Owner", email: `o-${crypto.randomUUID()}@x.ma`, role: "STORE_OWNER" })
    .returning();
  const [market] = await d
    .insert(markets)
    .values({
      slug: `m-${crypto.randomUUID()}`,
      name: "Souk Test",
      city: "Casablanca",
      lat: 33.57,
      lng: -7.59,
    })
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
    .values({ storeId: store!.id, name: "Babouches", priceMinor: 24900, stock, status: "ACTIVE" })
    .returning();
  return product!;
}

const ADDRESS = { line1: "18 rue Ibn Khaldoun", city: "Casablanca", lat: 33.58, lng: -7.61 };

describe("guest checkout", () => {
  it("lets a visitor with no account fill a cart", async () => {
    const product = await seedProduct();

    const added = await SELF.fetch(
      "https://x/api/cart/items",
      post({ productId: product.id, qty: 2 }),
    );
    expect(added.status).toBe(201);
    const cookie = cookiesOf(added);
    expect(cookie).toContain("qcart=");

    const cart = (await (
      await SELF.fetch("https://x/api/cart", { headers: { cookie } })
    ).json()) as { lines: { qty: number }[]; subtotalMinor: number };
    expect(cart.lines).toHaveLength(1);
    expect(cart.subtotalMinor).toBe(49800);
  });

  it("creates the account at the end of a first purchase and signs them in", async () => {
    const product = await seedProduct();
    const email = `guest-${crypto.randomUUID()}@x.ma`;

    const added = await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 1 }));
    const cartCookie = cookiesOf(added);

    const placed = await SELF.fetch(
      "https://x/api/orders",
      post(
        { address: ADDRESS, guest: { name: "Salma El Amrani", email }, paymentMethod: "COD" },
        cartCookie,
      ),
    );
    expect(placed.status).toBe(201);

    const [created] = await db().select().from(users).where(eq(users.email, email));
    expect(created!.role).toBe("CUSTOMER");
    expect(created!.status).toBe("ACTIVE");
    // No password given, so the account exists but cannot be signed into yet.
    expect(created!.passwordHash).toBeNull();

    // The response carries a session, so the order page works immediately.
    const session = cookiesOf(placed);
    const me = (await (
      await SELF.fetch("https://x/api/auth/me", { headers: { cookie: session } })
    ).json()) as { user: { email: string } | null };
    expect(me.user?.email).toBe(email);

    const mine = (await (
      await SELF.fetch("https://x/api/orders", { headers: { cookie: session } })
    ).json()) as { orders: unknown[] };
    expect(mine.orders).toHaveLength(1);
  });

  it("stores a password when the guest supplies one, so they can sign back in", async () => {
    const product = await seedProduct();
    const email = `guest-pw-${crypto.randomUUID()}@x.ma`;

    const added = await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 1 }));
    await SELF.fetch(
      "https://x/api/orders",
      post(
        { address: ADDRESS, guest: { name: "Salma", email, password: "motdepasse-123" } },
        cookiesOf(added),
      ),
    );

    const login = await SELF.fetch(
      "https://x/api/auth/login",
      post({ email, password: "motdepasse-123" }),
    );
    expect(login.status).toBe(200);
  });

  it("refuses to order as an email that already has a real account", async () => {
    const email = `member-${crypto.randomUUID()}@x.ma`;
    await db()
      .insert(users)
      .values({ name: "Member", email, passwordHash: await hashPassword("motdepasse-123") });

    const product = await seedProduct();
    const added = await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 1 }));

    const res = await SELF.fetch(
      "https://x/api/orders",
      post({ address: ADDRESS, guest: { name: "Imposteur", email } }, cookiesOf(added)),
    );
    // Silently ordering as them would be an account takeover.
    expect(res.status).toBe(409);
  });

  it("requires guest details when there is no session", async () => {
    const product = await seedProduct();
    const added = await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 1 }));

    const res = await SELF.fetch("https://x/api/orders", post({ address: ADDRESS }, cookiesOf(added)));
    expect(res.status).toBe(400);
  });

  it("rejects a checkout naming both a saved and an inline address", async () => {
    const product = await seedProduct();
    const added = await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 1 }));

    const res = await SELF.fetch(
      "https://x/api/orders",
      post(
        { addressId: crypto.randomUUID(), address: ADDRESS, guest: { name: "X", email: "x@y.ma" } },
        cookiesOf(added),
      ),
    );
    expect(res.status).toBe(400);
  });

  it("carries a guest basket over when they sign in mid-shop", async () => {
    const product = await seedProduct();
    const email = `shopper-${crypto.randomUUID()}@x.ma`;
    await db()
      .insert(users)
      .values({ name: "Shopper", email, passwordHash: await hashPassword("motdepasse-123") });

    const added = await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 3 }));
    const cartCookie = cookiesOf(added);

    const login = await SELF.fetch(
      "https://x/api/auth/login",
      post({ email, password: "motdepasse-123" }, cartCookie),
    );
    expect(login.status).toBe(200);

    const cart = (await (
      await SELF.fetch("https://x/api/cart", { headers: { cookie: cookiesOf(login) } })
    ).json()) as { lines: { qty: number }[] };
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.qty).toBe(3);
  });

  it("does not hand a claimed cart to a later visitor holding the stale cookie", async () => {
    const product = await seedProduct();
    const email = `claimed-${crypto.randomUUID()}@x.ma`;

    const added = await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 1 }));
    const stale = cookiesOf(added);
    await SELF.fetch(
      "https://x/api/orders",
      post({ address: ADDRESS, guest: { name: "Salma", email } }, stale),
    );

    // Same cookie, but the cart now belongs to someone: expect a fresh, empty one.
    const after = (await (
      await SELF.fetch("https://x/api/cart", { headers: { cookie: stale } })
    ).json()) as { lines: unknown[] };
    expect(after.lines).toHaveLength(0);

    const claimed = await db().select().from(carts);
    const owned = claimed.filter((c) => c.userId !== null);
    expect(owned.length).toBeGreaterThan(0);
  });

  it("still takes stock and creates a delivery for a guest order", async () => {
    const product = await seedProduct(4);
    const email = `stock-${crypto.randomUUID()}@x.ma`;

    const added = await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 2 }));
    const placed = await SELF.fetch(
      "https://x/api/orders",
      post({ address: ADDRESS, guest: { name: "Salma", email } }, cookiesOf(added)),
    );
    const { order } = (await placed.json()) as { order: { id: string } };

    const [after] = await db().select().from(products).where(eq(products.id, product.id));
    expect(after!.stock).toBe(2);

    const [row] = await db().select().from(orders).where(eq(orders.id, order.id));
    expect(row!.status).toBe("PENDING");
  });
});

describe("guest checkout phone collisions", () => {
  it("rejects a taken phone with a 409 the customer can act on, not a 500", async () => {
    const product = await seedProduct();
    const phone = `+2126${Math.floor(Math.random() * 100000000)}`;

    // Someone already holds this number.
    await db()
      .insert(users)
      .values({ name: "Titulaire", email: `owner-${crypto.randomUUID()}@x.ma`, phone, role: "CUSTOMER" });

    const added = await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 1 }));
    const res = await SELF.fetch(
      "https://x/api/orders",
      post(
        {
          address: ADDRESS,
          guest: { name: "Salma", email: `guest-${crypto.randomUUID()}@x.ma`, phone },
          paymentMethod: "COD",
        },
        cookiesOf(added),
      ),
    );

    // The UNIQUE constraint used to surface as an unhandled 500.
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain("numéro");
  });

  it("still lets a guest with a fresh phone check out", async () => {
    const product = await seedProduct();
    const added = await SELF.fetch("https://x/api/cart/items", post({ productId: product.id, qty: 1 }));
    const res = await SELF.fetch(
      "https://x/api/orders",
      post(
        {
          address: ADDRESS,
          guest: {
            name: "Salma",
            email: `guest-${crypto.randomUUID()}@x.ma`,
            phone: `+2127${Math.floor(Math.random() * 100000000)}`,
          },
          paymentMethod: "COD",
        },
        cookiesOf(added),
      ),
    );
    expect(res.status).toBe(201);
  });
});
