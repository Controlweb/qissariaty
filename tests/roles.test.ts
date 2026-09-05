import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { markets, stores, products, users, orders, deliveries } from "../worker/schema";
import { hashPassword } from "../worker/auth";

const db = () => drizzle(env.DB);
const PW = "correct-horse-battery";

const json = (body: unknown, cookie?: string) => ({
  method: "POST",
  headers: cookie
    ? { "content-type": "application/json", cookie }
    : { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Creates a user directly (bypassing the PENDING gate) and signs them in. */
async function signInAs(role: "CUSTOMER" | "STORE_OWNER" | "DELIVERER" | "ADMIN") {
  const email = `${role.toLowerCase()}-${crypto.randomUUID()}@x.ma`;
  const [user] = await db()
    .insert(users)
    .values({ name: role, email, role, status: "ACTIVE", passwordHash: await hashPassword(PW) })
    .returning();

  const res = await SELF.fetch("https://x/api/auth/login", json({ email, password: PW }));
  expect(res.status).toBe(200);
  return { user: user!, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
}

async function seedShop(ownerId: string, opts: { storeStatus?: "ACTIVE" | "PENDING" } = {}) {
  const d = db();
  const [market] = await d
    .insert(markets)
    .values({
      slug: `m-${crypto.randomUUID()}`,
      name: `Souk ${crypto.randomUUID().slice(0, 4)}`,
      city: "Casablanca",
      lat: 33.57,
      lng: -7.59,
    })
    .returning();
  const [store] = await d
    .insert(stores)
    .values({
      marketId: market!.id,
      ownerId,
      slug: `s-${crypto.randomUUID()}`,
      name: "Boutique Test",
      status: opts.storeStatus ?? "ACTIVE",
    })
    .returning();
  const [product] = await d
    .insert(products)
    .values({ storeId: store!.id, name: "Babouches en cuir", priceMinor: 24900, stock: 5, status: "ACTIVE" })
    .returning();
  return { market: market!, store: store!, product: product! };
}

describe("roles and access control", () => {
  it("refuses seller and admin endpoints to a plain customer", async () => {
    const { cookie } = await signInAs("CUSTOMER");
    for (const path of ["/api/me/stores", "/api/admin/kpis", "/api/admin/users"]) {
      const res = await SELF.fetch(`https://x${path}`, { headers: { cookie } });
      expect(res.status, path).toBe(403);
    }
  });

  it("refuses everything role-gated to an anonymous caller", async () => {
    for (const path of ["/api/me/stores", "/api/admin/kpis", "/api/deliveries/mine", "/api/addresses"]) {
      const res = await SELF.fetch(`https://x${path}`);
      expect(res.status, path).toBe(401);
    }
  });

  it("leaves the cart open to anonymous visitors", async () => {
    // Deliberate: a visitor shops first and gets an account at checkout.
    const res = await SELF.fetch("https://x/api/cart");
    expect(res.status).toBe(200);
  });

  it("stops a seller from touching another seller's store", async () => {
    const a = await signInAs("STORE_OWNER");
    const b = await signInAs("STORE_OWNER");
    const { store } = await seedShop(a.user.id);

    const res = await SELF.fetch(`https://x/api/stores/${store.id}/orders`, {
      headers: { cookie: b.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("lets a seller advance their own order and reflects it to the customer", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { product } = await seedShop(seller.user.id);
    const customer = await signInAs("CUSTOMER");

    await SELF.fetch("https://x/api/cart/items", json({ productId: product.id, qty: 1 }, customer.cookie));
    const addr = (await (
      await SELF.fetch(
        "https://x/api/addresses",
        json({ line1: "12 Rue Test", city: "Casablanca", lat: 33.57, lng: -7.59 }, customer.cookie),
      )
    ).json()) as { address: { id: string } };

    const placed = await SELF.fetch(
      "https://x/api/orders",
      json({ addressId: addr.address.id }, customer.cookie),
    );
    expect(placed.status).toBe(201);
    const { order } = (await placed.json()) as { order: { id: string } };

    const patched = await SELF.fetch(`https://x/api/orders/${order.id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: seller.cookie },
      body: JSON.stringify({ status: "CONFIRMED" }),
    });
    expect(patched.status).toBe(200);

    const [after] = await db().select().from(orders).where(eq(orders.id, order.id));
    expect(after!.status).toBe("CONFIRMED");
  });

  it("only one deliverer can claim a delivery", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { product } = await seedShop(seller.user.id);
    const customer = await signInAs("CUSTOMER");

    await SELF.fetch("https://x/api/cart/items", json({ productId: product.id, qty: 1 }, customer.cookie));
    const addr = (await (
      await SELF.fetch(
        "https://x/api/addresses",
        json({ line1: "9 Rue Test", city: "Casablanca", lat: 33.57, lng: -7.59 }, customer.cookie),
      )
    ).json()) as { address: { id: string } };
    const placed = await SELF.fetch(
      "https://x/api/orders",
      json({ addressId: addr.address.id }, customer.cookie),
    );
    const { order } = (await placed.json()) as { order: { id: string } };

    const d1 = await signInAs("DELIVERER");
    const d2 = await signInAs("DELIVERER");
    // Target this order's delivery specifically — the board is shared.
    const [row] = await db().select().from(deliveries).where(eq(deliveries.orderId, order.id));
    const id = row!.id;

    const first = await SELF.fetch(`https://x/api/deliveries/${id}/accept`, json({}, d1.cookie));
    const second = await SELF.fetch(`https://x/api/deliveries/${id}/accept`, json({}, d2.cookie));
    expect(first.status).toBe(200);
    // The `status = UNASSIGNED` predicate is the lock — the loser gets 409.
    expect(second.status).toBe(409);
  });

  it("gives a deliverer the drop-off address, and withholds it before the claim", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { product } = await seedShop(seller.user.id);
    const customer = await signInAs("CUSTOMER");

    await SELF.fetch("https://x/api/cart/items", json({ productId: product.id, qty: 1 }, customer.cookie));
    const addr = (await (
      await SELF.fetch(
        "https://x/api/addresses",
        json(
          { line1: "77 Derb Ghallef", city: "Casablanca", lat: 33.58, lng: -7.63, notes: "Interphone 6B" },
          customer.cookie,
        ),
      )
    ).json()) as { address: { id: string } };
    const placed = await SELF.fetch("https://x/api/orders", json({ addressId: addr.address.id }, customer.cookie));
    const { order } = (await placed.json()) as { order: { id: string } };
    const [row] = await db().select().from(deliveries).where(eq(deliveries.orderId, order.id));

    const courier = await signInAs("DELIVERER");

    // Unclaimed: the city and the fee, never the doorstep or the phone.
    const board = (await (
      await SELF.fetch("https://x/api/deliveries/available", { headers: { cookie: courier.cookie } })
    ).json()) as { deliveries: Record<string, unknown>[] };
    const offer = board.deliveries.find((d) => d.id === row!.id)!;
    expect(offer).toBeTruthy();
    expect(offer.dropCity).toBe("Casablanca");
    expect(offer.feeMinor).toBeTypeOf("number");
    expect(offer).not.toHaveProperty("dropLine1");
    expect(offer).not.toHaveProperty("customerPhone");

    await SELF.fetch(`https://x/api/deliveries/${row!.id}/accept`, json({}, courier.cookie));

    // Claimed: everything needed to actually make the delivery. The joins must
    // not drop the row — an inner join on a nullable addressId would.
    const mine = (await (
      await SELF.fetch("https://x/api/deliveries/mine", { headers: { cookie: courier.cookie } })
    ).json()) as { deliveries: Record<string, unknown>[] };
    const job = mine.deliveries.find((d) => d.id === row!.id)!;
    expect(job).toBeTruthy();
    expect(job.dropLine1).toBe("77 Derb Ghallef");
    expect(job.dropNotes).toBe("Interphone 6B");
    expect(job.customerName).toBe("CUSTOMER");
    expect(job.storeName).toBe("Boutique Test");
    expect(job.dropLat).toBe(33.58);
  });

  it("admin approval moves a pending store into public listings", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { store, market } = await seedShop(seller.user.id, { storeStatus: "PENDING" });
    const admin = await signInAs("ADMIN");

    const before = (await (
      await SELF.fetch(`https://x/api/markets/${market.id}/stores`)
    ).json()) as { stores: unknown[] };
    expect(before.stores).toHaveLength(0);

    const approved = await SELF.fetch(`https://x/api/admin/stores/${store.id}/approve`, json({}, admin.cookie));
    expect(approved.status).toBe(200);

    const after = (await (
      await SELF.fetch(`https://x/api/markets/${market.id}/stores`)
    ).json()) as { stores: unknown[] };
    expect(after.stores).toHaveLength(1);
  });

  it("searches across markets, stores and products", async () => {
    const seller = await signInAs("STORE_OWNER");
    await seedShop(seller.user.id);

    const res = await SELF.fetch("https://x/api/search?q=Babouches");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: { name: string }[]; total: number };
    expect(body.products.map((p) => p.name)).toContain("Babouches en cuir");

    // An empty q is a client bug, not an invitation to return the whole catalogue.
    expect((await SELF.fetch("https://x/api/search?q=")).status).toBe(400);
  });
});

describe("admin market management", () => {
  it("creates a market, slugs it, and exposes it publicly", async () => {
    const admin = await signInAs("ADMIN");
    const name = `Souk El Had ${crypto.randomUUID().slice(0, 4)}`;

    const res = await SELF.fetch(
      "https://x/api/admin/markets",
      json({ name, city: "Agadir", lat: 30.4278, lng: -9.5981, nameAr: "سوق الحد" }, admin.cookie),
    );
    expect(res.status).toBe(201);
    const { market } = (await res.json()) as { market: { id: string; slug: string; status: string } };
    expect(market.slug).toMatch(/^souk-el-had-/);
    expect(market.status).toBe("ACTIVE");

    // Nothing inserted into `markets` before this existed, so the public read
    // path is what proves a created souk is actually reachable.
    const listed = (await (
      await SELF.fetch("https://x/api/markets")
    ).json()) as { markets: { id: string }[] };
    expect(listed.markets.map((m) => m.id)).toContain(market.id);
  });

  it("edits the fields that were previously unreachable", async () => {
    const admin = await signInAs("ADMIN");
    const created = (await (
      await SELF.fetch(
        "https://x/api/admin/markets",
        json({ name: "Souk Test", city: "Fès", lat: 34.03, lng: -5.0 }, admin.cookie),
      )
    ).json()) as { market: { id: string } };

    const res = await SELF.fetch(`https://x/api/admin/markets/${created.market.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: admin.cookie },
      body: JSON.stringify({ city: "Meknès", lat: 33.895, lng: -5.554, status: "HIDDEN" }),
    });
    expect(res.status).toBe(200);

    const [row] = await db().select().from(markets).where(eq(markets.id, created.market.id));
    expect(row!.city).toBe("Meknès");
    expect(row!.lat).toBeCloseTo(33.895);
    expect(row!.status).toBe("HIDDEN");
  });

  it("rejects impossible coordinates and non-admins", async () => {
    const admin = await signInAs("ADMIN");
    const bad = await SELF.fetch(
      "https://x/api/admin/markets",
      json({ name: "Nulle part", city: "X", lat: 999, lng: 0 }, admin.cookie),
    );
    expect(bad.status).toBe(400);

    const owner = await signInAs("STORE_OWNER");
    const forbidden = await SELF.fetch(
      "https://x/api/admin/markets",
      json({ name: "Pirate", city: "Casablanca", lat: 33.5, lng: -7.6 }, owner.cookie),
    );
    expect(forbidden.status).toBe(403);
  });
});
