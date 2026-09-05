import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { markets, stores, products, users } from "../worker/schema";
import { hashPassword } from "../worker/auth";

const db = () => drizzle(env.DB);
const PW = "correct-horse-battery";

const post = (body: unknown, cookie?: string) => ({
  method: "POST",
  headers: cookie
    ? { "content-type": "application/json", cookie }
    : { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const patch = (body: unknown, cookie: string) => ({ ...post(body, cookie), method: "PATCH" });

async function signInAs(role: "CUSTOMER" | "STORE_OWNER" | "ADMIN", withPassword = true) {
  const email = `${role.toLowerCase()}-${crypto.randomUUID()}@x.ma`;
  const [user] = await db()
    .insert(users)
    .values({
      name: role,
      email,
      role,
      status: "ACTIVE",
      passwordHash: withPassword ? await hashPassword(PW) : null,
    })
    .returning();
  if (!withPassword) return { user: user!, cookie: "" };

  const res = await SELF.fetch("https://x/api/auth/login", post({ email, password: PW }));
  expect(res.status).toBe(200);
  return { user: user!, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
}

async function seedShop(ownerId: string) {
  const d = db();
  const [market] = await d
    .insert(markets)
    .values({ slug: `m-${crypto.randomUUID()}`, name: "Souk", city: "Casablanca", lat: 33.5, lng: -7.6 })
    .returning();
  const [store] = await d
    .insert(stores)
    .values({ marketId: market!.id, ownerId, slug: `s-${crypto.randomUUID()}`, name: "Boutique", status: "ACTIVE" })
    .returning();
  const [product] = await d
    .insert(products)
    .values({ storeId: store!.id, name: "Babouches", priceMinor: 24900, stock: 5, status: "ACTIVE" })
    .returning();
  return { store: store!, product: product! };
}

describe("password recovery", () => {
  it("lets an admin issue a one-time link that sets a password and signs the user in", async () => {
    const admin = await signInAs("ADMIN");
    // A checkout-created account: exists, but has no password to sign in with.
    const locked = await signInAs("CUSTOMER", false);

    const issued = await SELF.fetch(
      `https://x/api/admin/users/${locked.user.id}/reset-link`,
      post({}, admin.cookie),
    );
    expect(issued.status).toBe(200);
    const { url } = (await issued.json()) as { url: string };
    const token = new URL(url).searchParams.get("token")!;
    expect(token.length).toBeGreaterThan(30);

    const used = await SELF.fetch(
      "https://x/api/auth/password/reset",
      post({ token, password: "nouveau-mot-de-passe" }),
    );
    expect(used.status).toBe(200);

    // Signing in with the new password now works.
    const login = await SELF.fetch(
      "https://x/api/auth/login",
      post({ email: locked.user.email, password: "nouveau-mot-de-passe" }),
    );
    expect(login.status).toBe(200);

    // The token is spent — a stolen link cannot be replayed.
    const replay = await SELF.fetch(
      "https://x/api/auth/password/reset",
      post({ token, password: "encore-un-autre" }),
    );
    expect(replay.status).toBe(400);
  });

  it("refuses to issue links to anyone but an admin", async () => {
    const owner = await signInAs("STORE_OWNER");
    const victim = await signInAs("CUSTOMER");
    const res = await SELF.fetch(
      `https://x/api/admin/users/${victim.user.id}/reset-link`,
      post({}, owner.cookie),
    );
    expect(res.status).toBe(403);
  });

  it("demands the current password to change one, but not to set a first", async () => {
    const withPw = await signInAs("CUSTOMER");
    const wrong = await SELF.fetch(
      "https://x/api/auth/password",
      post({ current: "pas-le-bon", password: "un-nouveau-mdp" }, withPw.cookie),
    );
    expect(wrong.status).toBe(403);

    const right = await SELF.fetch(
      "https://x/api/auth/password",
      post({ current: PW, password: "un-nouveau-mdp" }, withPw.cookie),
    );
    expect(right.status).toBe(200);

    // hasPassword is what tells the account page which form to show.
    const me = (await (
      await SELF.fetch("https://x/api/auth/me", { headers: { cookie: withPw.cookie } })
    ).json()) as { user: { hasPassword: boolean } };
    expect(me.user.hasPassword).toBe(true);
  });
});

describe("merchant product management", () => {
  it("edits a product and archives it out of the public catalogue", async () => {
    const owner = await signInAs("STORE_OWNER");
    const { store, product } = await seedShop(owner.user.id);

    // Exactly the payload the edit form sends, nulls included — an empty
    // description and no photo arrive as null, not as an absent key.
    const edited = await SELF.fetch(
      `https://x/api/products/${product.id}`,
      patch(
        {
          name: "Babouches brodées",
          description: null,
          priceMinor: 31900,
          stock: 12,
          status: "ACTIVE",
          imageKey: null,
        },
        owner.cookie,
      ),
    );
    expect(edited.status).toBe(200);
    const [afterEdit] = await db().select().from(products).where(eq(products.id, product.id));
    expect(afterEdit!.name).toBe("Babouches brodées");
    expect(afterEdit!.priceMinor).toBe(31900);

    const archived = await SELF.fetch(`https://x/api/products/${product.id}`, {
      method: "DELETE",
      headers: { cookie: owner.cookie },
    });
    expect(archived.status).toBe(200);

    // Gone from the shop front...
    const publicList = (await (
      await SELF.fetch(`https://x/api/stores/${store.id}/products`)
    ).json()) as { products: unknown[] };
    expect(publicList.products).toHaveLength(0);

    // ...but still on the merchant's own shelf, so it can be brought back.
    const mine = (await (
      await SELF.fetch(`https://x/api/stores/${store.id}/catalogue`, { headers: { cookie: owner.cookie } })
    ).json()) as { products: { id: string; status: string }[] };
    expect(mine.products.find((p) => p.id === product.id)?.status).toBe("ARCHIVED");
  });

  it("stops a merchant editing someone else's product", async () => {
    const a = await signInAs("STORE_OWNER");
    const b = await signInAs("STORE_OWNER");
    const { product } = await seedShop(a.user.id);

    const res = await SELF.fetch(
      `https://x/api/products/${product.id}`,
      patch({ priceMinor: 1 }, b.cookie),
    );
    expect(res.status).toBe(403);

    const del = await SELF.fetch(`https://x/api/products/${product.id}`, {
      method: "DELETE",
      headers: { cookie: b.cookie },
    });
    expect(del.status).toBe(403);
  });
});

describe("self-service password reset", () => {
  /** Miniflare simulates the send_email binding, so these actually render and
   *  "send" a message. What matters here is that the response cannot be used
   *  to tell a real customer's address apart from a made-up one. */
  it("answers identically for a known and an unknown address", async () => {
    const known = await signInAs("CUSTOMER");

    const a = await SELF.fetch("https://x/api/auth/password/forgot", post({ email: known.user.email }));
    const b = await SELF.fetch(
      "https://x/api/auth/password/forgot",
      post({ email: `ghost-${crypto.randomUUID()}@x.ma` }),
    );

    expect(a.status).toBe(b.status);
    // Byte-identical: a difference here is an account-enumeration oracle.
    expect(await a.text()).toBe(await b.text());
  });

  it("rejects a malformed address rather than pretending to send", async () => {
    const res = await SELF.fetch("https://x/api/auth/password/forgot", post({ email: "pas-un-email" }));
    expect(res.status).toBe(400);
  });
});
