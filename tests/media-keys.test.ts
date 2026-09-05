import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users, stores, markets, products, deliveries, orders, addresses } from "../worker/schema";
import { hashPassword } from "../worker/auth";

const db = () => drizzle(env.DB);
const PW = "correct-horse-battery";

const send = (body: unknown, cookie?: string, method = "POST") => ({
  method,
  headers: cookie
    ? { "content-type": "application/json", cookie }
    : { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function signInAs(role: "CUSTOMER" | "STORE_OWNER" | "DELIVERER" | "ADMIN") {
  const email = `${role}-${crypto.randomUUID()}@x.ma`;
  const [user] = await db()
    .insert(users)
    .values({ name: role, email, role, status: "ACTIVE", passwordHash: await hashPassword(PW) })
    .returning();
  const res = await SELF.fetch("https://x/api/auth/login", send({ email, password: PW }));
  return { user: user!, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
}

const key = (prefix: string, ext = "webp") => `${prefix}/${crypto.randomUUID()}.${ext}`;

async function seedShop(ownerId: string) {
  const d = db();
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
      ownerId,
      slug: `s-${crypto.randomUUID()}`,
      name: "Boutique Test",
      status: "ACTIVE",
    })
    .returning();
  const [product] = await d
    .insert(products)
    .values({ storeId: store!.id, name: "Babouches", priceMinor: 24900, stock: 5, status: "ACTIVE" })
    .returning();
  return { market: market!, store: store!, product: product! };
}

describe("image keys are persisted and guarded", () => {
  it("stores an avatar against the caller and reflects it in the session", async () => {
    const me = await signInAs("CUSTOMER");
    const avatarKey = key("avatars");

    const res = await SELF.fetch("https://x/api/me", send({ avatarKey }, me.cookie, "PATCH"));
    expect(res.status).toBe(200);

    const session = (await (
      await SELF.fetch("https://x/api/auth/me", { headers: { cookie: me.cookie } })
    ).json()) as { user: { avatarKey: string | null } };
    expect(session.user.avatarKey).toBe(avatarKey);
  });

  it("cannot be used to self-promote, because role is not in the schema", async () => {
    const me = await signInAs("CUSTOMER");
    await SELF.fetch("https://x/api/me", send({ role: "ADMIN", status: "ACTIVE" }, me.cookie, "PATCH"));

    const [after] = await db().select().from(users).where(eq(users.id, me.user.id));
    expect(after!.role).toBe("CUSTOMER");
  });

  it("stores a shop logo for its owner and refuses another merchant", async () => {
    const owner = await signInAs("STORE_OWNER");
    const stranger = await signInAs("STORE_OWNER");
    const { store } = await seedShop(owner.user.id);
    const logoKey = key("stores");

    const ok = await SELF.fetch(
      `https://x/api/stores/${store.id}`,
      send({ logoKey }, owner.cookie, "PATCH"),
    );
    expect(ok.status).toBe(200);

    const [after] = await db().select().from(stores).where(eq(stores.id, store.id));
    expect(after!.logoKey).toBe(logoKey);

    const denied = await SELF.fetch(
      `https://x/api/stores/${store.id}`,
      send({ logoKey: key("stores") }, stranger.cookie, "PATCH"),
    );
    expect(denied.status).toBe(403);
  });

  it("stores a market cover for an admin and refuses a merchant", async () => {
    const owner = await signInAs("STORE_OWNER");
    const admin = await signInAs("ADMIN");
    const { market } = await seedShop(owner.user.id);
    const coverKey = key("markets");

    const denied = await SELF.fetch(
      `https://x/api/admin/markets/${market.id}`,
      send({ coverKey }, owner.cookie, "PATCH"),
    );
    expect(denied.status).toBe(403);

    const ok = await SELF.fetch(
      `https://x/api/admin/markets/${market.id}`,
      send({ coverKey }, admin.cookie, "PATCH"),
    );
    expect(ok.status).toBe(200);

    const [after] = await db().select().from(markets).where(eq(markets.id, market.id));
    expect(after!.coverKey).toBe(coverKey);
  });

  it("stores a delivery proof when the courier closes the job", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { product } = await seedShop(seller.user.id);
    const customer = await signInAs("CUSTOMER");

    await SELF.fetch(
      "https://x/api/cart/items",
      send({ productId: product.id, qty: 1 }, customer.cookie),
    );
    const addr = (await (
      await SELF.fetch(
        "https://x/api/addresses",
        send({ line1: "12 Rue Test", city: "Casablanca", lat: 33.57, lng: -7.59 }, customer.cookie),
      )
    ).json()) as { address: { id: string } };
    const placed = await SELF.fetch(
      "https://x/api/orders",
      send({ addressId: addr.address.id }, customer.cookie),
    );
    const { order } = (await placed.json()) as { order: { id: string } };

    const courier = await signInAs("DELIVERER");
    const [row] = await db().select().from(deliveries).where(eq(deliveries.orderId, order.id));
    await SELF.fetch(`https://x/api/deliveries/${row!.id}/accept`, send({}, courier.cookie));

    const proofKey = key("delivery-proofs");
    const done = await SELF.fetch(
      `https://x/api/deliveries/${row!.id}/delivered`,
      send({ proofKey }, courier.cookie),
    );
    expect(done.status).toBe(200);

    const [after] = await db().select().from(deliveries).where(eq(deliveries.id, row!.id));
    expect(after!.status).toBe("DELIVERED");
    expect(after!.proofKey).toBe(proofKey);
  });

  it("still completes a delivery when the courier has no photo", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { product } = await seedShop(seller.user.id);
    const customer = await signInAs("CUSTOMER");

    await SELF.fetch(
      "https://x/api/cart/items",
      send({ productId: product.id, qty: 1 }, customer.cookie),
    );
    const addr = (await (
      await SELF.fetch(
        "https://x/api/addresses",
        send({ line1: "9 Rue Test", city: "Casablanca", lat: 33.57, lng: -7.59 }, customer.cookie),
      )
    ).json()) as { address: { id: string } };
    const placed = await SELF.fetch(
      "https://x/api/orders",
      send({ addressId: addr.address.id }, customer.cookie),
    );
    const { order } = (await placed.json()) as { order: { id: string } };

    const courier = await signInAs("DELIVERER");
    const [row] = await db().select().from(deliveries).where(eq(deliveries.orderId, order.id));
    await SELF.fetch(`https://x/api/deliveries/${row!.id}/accept`, send({}, courier.cookie));

    // A dead camera must not strand a delivered parcel in transit.
    const done = await SELF.fetch(
      `https://x/api/deliveries/${row!.id}/delivered`,
      send({}, courier.cookie),
    );
    expect(done.status).toBe(200);

    const [after] = await db().select().from(deliveries).where(eq(deliveries.id, row!.id));
    expect(after!.proofKey).toBeNull();
  });

  it("rejects a key that is not one this server issued", async () => {
    const me = await signInAs("CUSTOMER");
    for (const bad of [
      "avatars/../../etc/passwd",
      "https://evil.example/x.webp",
      "avatars/not-a-uuid.webp",
      "invoices/11111111-1111-4111-8111-111111111111.webp",
      "avatars/11111111-1111-4111-8111-111111111111.svg",
    ]) {
      const res = await SELF.fetch("https://x/api/me", send({ avatarKey: bad }, me.cookie, "PATCH"));
      expect(res.status, bad).toBe(400);
    }
  });

  it("accepts null to clear an image", async () => {
    const me = await signInAs("CUSTOMER");
    await SELF.fetch("https://x/api/me", send({ avatarKey: key("avatars") }, me.cookie, "PATCH"));
    const cleared = await SELF.fetch(
      "https://x/api/me",
      send({ avatarKey: null }, me.cookie, "PATCH"),
    );
    expect(cleared.status).toBe(200);

    const [after] = await db().select().from(users).where(eq(users.id, me.user.id));
    expect(after!.avatarKey).toBeNull();
  });
});
