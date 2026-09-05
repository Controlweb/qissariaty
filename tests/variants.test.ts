import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { markets, stores, products, users, productVariants, deliveries } from "../worker/schema";
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
  const email = `${role.toLowerCase()}-${crypto.randomUUID()}@x.ma`;
  const [user] = await db()
    .insert(users)
    .values({ name: role, email, role, status: "ACTIVE", passwordHash: await hashPassword(PW) })
    .returning();
  const res = await SELF.fetch("https://x/api/auth/login", send({ email, password: PW }));
  return { user: user!, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
}

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
    .values({ storeId: store!.id, name: "Babouches", priceMinor: 24900, stock: 0, status: "ACTIVE" })
    .returning();
  return { store: store!, product: product! };
}

const VARIANTS = {
  options: [
    { name: "Couleur", values: ["Rouge", "Bleu"] },
    { name: "Taille", values: ["M", "L"] },
  ],
  variants: [
    { options: { Couleur: "Rouge", Taille: "M" }, priceMinor: 24900, stock: 3 },
    { options: { Couleur: "Rouge", Taille: "L" }, priceMinor: 26900, stock: 0 },
    { options: { Couleur: "Bleu", Taille: "M" }, priceMinor: 24900, stock: 5 },
    { options: { Couleur: "Bleu", Taille: "L" }, priceMinor: 26900, stock: 2 },
  ],
};

async function addAddress(cookie: string) {
  const res = await SELF.fetch(
    "https://x/api/addresses",
    send({ line1: "12 Rue Test", city: "Casablanca", lat: 33.57, lng: -7.59 }, cookie),
  );
  return ((await res.json()) as { address: { id: string } }).address.id;
}

describe("product variants", () => {
  it("rolls variant price and stock up onto the product", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { product } = await seedShop(seller.user.id);

    const saved = await SELF.fetch(
      `https://x/api/products/${product.id}/variants`,
      send(VARIANTS, seller.cookie, "PUT"),
    );
    expect(saved.status).toBe(200);

    const [after] = await db().select().from(products).where(eq(products.id, product.id));
    // Cheapest variant, and the sum of all variant stock.
    expect(after!.priceMinor).toBe(24900);
    expect(after!.stock).toBe(10);
  });

  it("rejects a variant whose options do not match the declared axes", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { product } = await seedShop(seller.user.id);

    const res = await SELF.fetch(
      `https://x/api/products/${product.id}/variants`,
      send(
        {
          options: [{ name: "Couleur", values: ["Rouge"] }],
          variants: [{ options: { Taille: "M" }, priceMinor: 1000, stock: 1 }],
        },
        seller.cookie,
        "PUT",
      ),
    );
    expect(res.status).toBe(400);
  });

  it("refuses to add a varied product to the cart without a choice", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { product } = await seedShop(seller.user.id);
    await SELF.fetch(`https://x/api/products/${product.id}/variants`, send(VARIANTS, seller.cookie, "PUT"));

    const customer = await signInAs("CUSTOMER");
    const res = await SELF.fetch(
      "https://x/api/cart/items",
      send({ productId: product.id, qty: 1 }, customer.cookie),
    );
    expect(res.status).toBe(400);
  });

  it("keeps two variants of one product as separate cart lines, priced apart", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { product } = await seedShop(seller.user.id);
    await SELF.fetch(`https://x/api/products/${product.id}/variants`, send(VARIANTS, seller.cookie, "PUT"));

    const all = await db().select().from(productVariants).where(eq(productVariants.productId, product.id));
    const rougeM = all.find((v) => v.label === "Rouge · M")!;
    const bleuL = all.find((v) => v.label === "Bleu · L")!;

    const customer = await signInAs("CUSTOMER");
    await SELF.fetch(
      "https://x/api/cart/items",
      send({ productId: product.id, variantId: rougeM.id, qty: 1 }, customer.cookie),
    );
    await SELF.fetch(
      "https://x/api/cart/items",
      send({ productId: product.id, variantId: bleuL.id, qty: 1 }, customer.cookie),
    );

    const cart = (await (
      await SELF.fetch("https://x/api/cart", { headers: { cookie: customer.cookie } })
    ).json()) as { lines: { variantLabel: string; priceMinor: number }[]; subtotalMinor: number };

    expect(cart.lines).toHaveLength(2);
    expect(cart.lines.map((l) => l.variantLabel).sort()).toEqual(["Bleu · L", "Rouge · M"]);
    // 249.00 + 269.00 — the variant price wins over the product's.
    expect(cart.subtotalMinor).toBe(24900 + 26900);
  });

  it("takes stock from the variant, not the product, at checkout", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { product } = await seedShop(seller.user.id);
    await SELF.fetch(`https://x/api/products/${product.id}/variants`, send(VARIANTS, seller.cookie, "PUT"));

    const all = await db().select().from(productVariants).where(eq(productVariants.productId, product.id));
    const bleuM = all.find((v) => v.label === "Bleu · M")!;

    const customer = await signInAs("CUSTOMER");
    await SELF.fetch(
      "https://x/api/cart/items",
      send({ productId: product.id, variantId: bleuM.id, qty: 2 }, customer.cookie),
    );
    const addressId = await addAddress(customer.cookie);
    const placed = await SELF.fetch("https://x/api/orders", send({ addressId }, customer.cookie));
    expect(placed.status).toBe(201);

    const [after] = await db().select().from(productVariants).where(eq(productVariants.id, bleuM.id));
    expect(after!.stock).toBe(3);
  });

  it("refuses to oversell a variant that is out of stock", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { product } = await seedShop(seller.user.id);
    await SELF.fetch(`https://x/api/products/${product.id}/variants`, send(VARIANTS, seller.cookie, "PUT"));

    const all = await db().select().from(productVariants).where(eq(productVariants.productId, product.id));
    const rougeL = all.find((v) => v.label === "Rouge · L")!; // stock 0

    const customer = await signInAs("CUSTOMER");
    await SELF.fetch(
      "https://x/api/cart/items",
      send({ productId: product.id, variantId: rougeL.id, qty: 1 }, customer.cookie),
    );
    const addressId = await addAddress(customer.cookie);
    const res = await SELF.fetch("https://x/api/orders", send({ addressId }, customer.cookie));
    expect(res.status).toBe(409);
  });
});

describe("reviews", () => {
  it("only accepts a review once the order was delivered, and only once", async () => {
    const seller = await signInAs("STORE_OWNER");
    const { store, product } = await seedShop(seller.user.id);
    await db().update(products).set({ stock: 5 }).where(eq(products.id, product.id));
    const customer = await signInAs("CUSTOMER");

    // Before ordering: refused.
    const early = await SELF.fetch(
      "https://x/api/reviews",
      send({ rating: 5, storeId: store.id }, customer.cookie),
    );
    expect(early.status).toBe(403);

    await SELF.fetch(
      "https://x/api/cart/items",
      send({ productId: product.id, qty: 1 }, customer.cookie),
    );
    const addressId = await addAddress(customer.cookie);
    const placed = await SELF.fetch("https://x/api/orders", send({ addressId }, customer.cookie));
    const { order } = (await placed.json()) as { order: { id: string } };

    // Placed but not delivered: still refused.
    const pending = await SELF.fetch(
      "https://x/api/reviews",
      send({ rating: 5, storeId: store.id }, customer.cookie),
    );
    expect(pending.status).toBe(403);

    const deliverer = await signInAs("DELIVERER");
    // Look the delivery up by order id: the shared job board also carries
    // deliveries created by other tests in this file.
    const [row] = await db().select().from(deliveries).where(eq(deliveries.orderId, order.id));
    const did = row!.id;
    await SELF.fetch(`https://x/api/deliveries/${did}/accept`, send({}, deliverer.cookie));
    await SELF.fetch(`https://x/api/deliveries/${did}/delivered`, send({}, deliverer.cookie));

    const ok = await SELF.fetch(
      "https://x/api/reviews",
      send({ rating: 5, body: "Excellent", storeId: store.id }, customer.cookie),
    );
    expect(ok.status).toBe(201);

    const twice = await SELF.fetch(
      "https://x/api/reviews",
      send({ rating: 4, storeId: store.id }, customer.cookie),
    );
    expect(twice.status).toBe(409);

    const listed = (await (await SELF.fetch(`https://x/api/stores/${store.id}/reviews`)).json()) as {
      count: number;
      average: number;
    };
    expect(listed.count).toBe(1);
    expect(listed.average).toBe(5);
  });

  it("rejects a review naming both a store and a product", async () => {
    const customer = await signInAs("CUSTOMER");
    const res = await SELF.fetch(
      "https://x/api/reviews",
      send(
        { rating: 5, storeId: crypto.randomUUID(), productId: crypto.randomUUID() },
        customer.cookie,
      ),
    );
    expect(res.status).toBe(400);
  });
});
