import { env, SELF } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users, stores, markets, products } from "../worker/schema";
import { hashPassword } from "../worker/auth";

const db = () => drizzle(env.DB);
const PW = "correct-horse-battery";

const send = (body: unknown, cookie?: string, method = "PATCH") => ({
  method,
  headers: cookie
    ? { "content-type": "application/json", cookie }
    : { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function signInAs(role: "CUSTOMER" | "STORE_OWNER" | "ADMIN") {
  const email = `${role}-${crypto.randomUUID()}@x.ma`;
  const [user] = await db()
    .insert(users)
    .values({ name: role, email, role, status: "ACTIVE", passwordHash: await hashPassword(PW) })
    .returning();
  const res = await SELF.fetch("https://x/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  return { user: user!, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
}

/** Puts a real object in R2 under a well-formed key. */
async function store(prefix: string) {
  const key = `${prefix}/${crypto.randomUUID()}.webp`;
  await env.MEDIA.put(key, new Uint8Array([1, 2, 3, 4]));
  return key;
}

const exists = async (key: string) => (await env.MEDIA.head(key)) !== null;

/**
 * Cleanup runs in `waitUntil`, so it is not finished when the response
 * resolves — that is the point, since a slow R2 delete must not hold up the
 * save. Tests therefore poll rather than assume.
 */
const expectGone = (key: string) =>
  vi.waitFor(async () => expect(await exists(key)).toBe(false), { timeout: 3000, interval: 50 });

/** For the opposite claim, settle briefly and confirm it is still there. */
const expectKept = async (key: string) => {
  await new Promise((r) => setTimeout(r, 300));
  expect(await exists(key)).toBe(true);
};

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
  const [shop] = await d
    .insert(stores)
    .values({
      marketId: market!.id,
      ownerId,
      slug: `s-${crypto.randomUUID()}`,
      name: "Boutique Test",
      status: "ACTIVE",
    })
    .returning();
  return { market: market!, store: shop! };
}

describe("replaced images are removed from R2", () => {
  it("deletes the previous avatar and keeps the new one", async () => {
    const me = await signInAs("CUSTOMER");
    const first = await store("avatars");
    const second = await store("avatars");

    await SELF.fetch("https://x/api/me", send({ avatarKey: first }, me.cookie));
    expect(await exists(first)).toBe(true);

    await SELF.fetch("https://x/api/me", send({ avatarKey: second }, me.cookie));
    await expectGone(first);
    expect(await exists(second)).toBe(true);
  });

  it("deletes the image when it is cleared to null", async () => {
    const me = await signInAs("CUSTOMER");
    const key = await store("avatars");

    await SELF.fetch("https://x/api/me", send({ avatarKey: key }, me.cookie));
    await SELF.fetch("https://x/api/me", send({ avatarKey: null }, me.cookie));

    await expectGone(key);
  });

  it("leaves the image alone when the patch does not mention it", async () => {
    const me = await signInAs("CUSTOMER");
    const key = await store("avatars");

    await SELF.fetch("https://x/api/me", send({ avatarKey: key }, me.cookie));
    // An unrelated edit must not be read as "remove my picture".
    await SELF.fetch("https://x/api/me", send({ name: "Nouveau Nom" }, me.cookie));

    await expectKept(key);
    const [after] = await db().select().from(users).where(eq(users.id, me.user.id));
    expect(after!.avatarKey).toBe(key);
  });

  it("does not delete when the same key is submitted again", async () => {
    const me = await signInAs("CUSTOMER");
    const key = await store("avatars");

    await SELF.fetch("https://x/api/me", send({ avatarKey: key }, me.cookie));
    await SELF.fetch("https://x/api/me", send({ avatarKey: key }, me.cookie));

    await expectKept(key);
  });

  it("refuses to delete an object another record still points at", async () => {
    // The attack this guards: claim someone else's key, then clear it and take
    // their image down with you.
    const victim = await signInAs("CUSTOMER");
    const attacker = await signInAs("CUSTOMER");
    const shared = await store("avatars");

    await SELF.fetch("https://x/api/me", send({ avatarKey: shared }, victim.cookie));
    await SELF.fetch("https://x/api/me", send({ avatarKey: shared }, attacker.cookie));

    await SELF.fetch("https://x/api/me", send({ avatarKey: null }, attacker.cookie));

    // Still referenced by the victim, so it survives.
    await expectKept(shared);
    const [v] = await db().select().from(users).where(eq(users.id, victim.user.id));
    expect(v!.avatarKey).toBe(shared);
  });

  it("cleans up a replaced shop logo", async () => {
    const owner = await signInAs("STORE_OWNER");
    const { store: shop } = await seedShop(owner.user.id);
    const first = await store("stores");
    const second = await store("stores");

    await SELF.fetch(`https://x/api/stores/${shop.id}`, send({ logoKey: first }, owner.cookie));
    await SELF.fetch(`https://x/api/stores/${shop.id}`, send({ logoKey: second }, owner.cookie));

    await expectGone(first);
    expect(await exists(second)).toBe(true);
  });

  it("cleans up a replaced market cover", async () => {
    const owner = await signInAs("STORE_OWNER");
    const admin = await signInAs("ADMIN");
    const { market } = await seedShop(owner.user.id);
    const first = await store("markets");
    const second = await store("markets");

    await SELF.fetch(
      `https://x/api/admin/markets/${market.id}`,
      send({ coverKey: first }, admin.cookie),
    );
    await SELF.fetch(
      `https://x/api/admin/markets/${market.id}`,
      send({ coverKey: second }, admin.cookie),
    );

    await expectGone(first);
    expect(await exists(second)).toBe(true);
  });

  it("cleans up a replaced product image", async () => {
    const owner = await signInAs("STORE_OWNER");
    const { store: shop } = await seedShop(owner.user.id);
    const first = await store("products");
    const second = await store("products");

    const [product] = await db()
      .insert(products)
      .values({
        storeId: shop.id,
        name: "Babouches",
        priceMinor: 24900,
        stock: 3,
        status: "ACTIVE",
        imageKey: first,
      })
      .returning();

    await SELF.fetch(
      `https://x/api/products/${product!.id}`,
      send({ imageKey: second }, owner.cookie),
    );

    await expectGone(first);
    expect(await exists(second)).toBe(true);
  });

  it("survives a key whose object is already gone", async () => {
    const me = await signInAs("CUSTOMER");
    const key = `avatars/${crypto.randomUUID()}.webp`; // never uploaded

    await SELF.fetch("https://x/api/me", send({ avatarKey: key }, me.cookie));
    const res = await SELF.fetch("https://x/api/me", send({ avatarKey: null }, me.cookie));

    // R2 delete on a missing key is a no-op; the save must still succeed.
    expect(res.status).toBe(200);
  });
});
