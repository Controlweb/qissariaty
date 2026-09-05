import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { markets, users, stores, delivererProfiles } from "../worker/schema";

const db = () => drizzle(env.DB);

const post = (body: unknown, cookie?: string) => ({
  method: "POST",
  headers: cookie
    ? { "content-type": "application/json", cookie }
    : { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Registers through the public endpoint, exactly as step 1 of a wizard does. */
async function registerVisitor() {
  const email = `visitor-${crypto.randomUUID()}@x.ma`;
  const res = await SELF.fetch(
    "https://x/api/auth/register",
    post({ name: "Karim Bennani", email, password: "motdepasse-123" }),
  );
  expect(res.status).toBe(201);
  const { user } = (await res.json()) as { user: { id: string; role: string } };
  // A wizard starts everyone as a customer; the role changes only on submit.
  expect(user.role).toBe("CUSTOMER");
  return { user, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
}

async function seedMarket() {
  const [market] = await db()
    .insert(markets)
    .values({
      slug: `m-${crypto.randomUUID()}`,
      name: "Souk Test",
      city: "Casablanca",
      lat: 33.57,
      lng: -7.59,
    })
    .returning();
  return market!;
}

describe("merchant onboarding", () => {
  it("promotes a customer to STORE_OWNER and files the shop as PENDING", async () => {
    const { user, cookie } = await registerVisitor();
    const market = await seedMarket();

    const res = await SELF.fetch(
      "https://x/api/seller/apply",
      post(
        {
          name: "Tissus Bennani",
          marketId: market.id,
          category: "Textile",
          registryNumber: "RC 148920",
          description: "Tissus et broderie depuis 1978.",
          lat: 33.57,
          lng: -7.59,
        },
        cookie,
      ),
    );
    expect(res.status).toBe(201);

    const [after] = await db().select().from(users).where(eq(users.id, user.id));
    expect(after!.role).toBe("STORE_OWNER");

    const [shop] = await db().select().from(stores).where(eq(stores.ownerId, user.id));
    expect(shop!.status).toBe("PENDING");
    expect(shop!.category).toBe("Textile");
    expect(shop!.registryNumber).toBe("RC 148920");

    // PENDING means invisible to customers until an admin approves.
    const listed = (await (
      await SELF.fetch(`https://x/api/markets/${market.id}/stores`)
    ).json()) as { stores: unknown[] };
    expect(listed.stores).toHaveLength(0);
  });

  it("derives a unique slug when two shops share a name", async () => {
    const market = await seedMarket();
    const a = await registerVisitor();
    const b = await registerVisitor();

    for (const who of [a, b]) {
      const res = await SELF.fetch(
        "https://x/api/seller/apply",
        post({ name: "Bazar Atlas", marketId: market.id, lat: 33.57, lng: -7.59 }, who.cookie),
      );
      expect(res.status).toBe(201);
    }

    const shops = await db().select().from(stores).where(eq(stores.marketId, market.id));
    const slugs = shops.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("rejects an application naming a market that does not exist", async () => {
    const { cookie } = await registerVisitor();
    const res = await SELF.fetch(
      "https://x/api/seller/apply",
      post({ name: "Boutique", marketId: crypto.randomUUID(), lat: 33.5, lng: -7.5 }, cookie),
    );
    expect(res.status).toBe(400);
  });

  it("queues a market proposal instead of blocking the applicant", async () => {
    const { cookie } = await registerVisitor();
    const res = await SELF.fetch(
      "https://x/api/market-requests",
      post({ name: "Souk El Had", city: "Agadir", note: "40 boutiques" }, cookie),
    );
    expect(res.status).toBe(201);
  });

  it("refuses onboarding endpoints to anonymous callers", async () => {
    for (const path of ["/api/seller/apply", "/api/deliverer/apply", "/api/market-requests"]) {
      const res = await SELF.fetch(`https://x${path}`, post({}));
      expect(res.status, path).toBe(401);
    }
  });
});

describe("deliverer onboarding", () => {
  it("files the profile and leaves the account PENDING", async () => {
    const { user, cookie } = await registerVisitor();

    const res = await SELF.fetch(
      "https://x/api/deliverer/apply",
      post(
        {
          vehicle: "Scooter",
          plate: "12345-A-6",
          idNumber: "AB123456",
          city: "Casablanca",
          zones: ["Habous", "Maârif"],
          availability: "Lun–Sam, 09:00 – 19:00",
        },
        cookie,
      ),
    );
    expect(res.status).toBe(201);

    const [after] = await db().select().from(users).where(eq(users.id, user.id));
    expect(after!.role).toBe("DELIVERER");
    // Vetting gate: a fresh deliverer must not be able to take jobs.
    expect(after!.status).toBe("PENDING");

    const [profile] = await db()
      .select()
      .from(delivererProfiles)
      .where(eq(delivererProfiles.userId, user.id));
    expect(profile!.zones).toEqual(["Habous", "Maârif"]);
    expect(profile!.plate).toBe("12345-A-6");
  });

  it("locks a pending deliverer out until an admin activates them", async () => {
    const { cookie } = await registerVisitor();
    await SELF.fetch(
      "https://x/api/deliverer/apply",
      post({ vehicle: "Vélo", city: "Casablanca", zones: ["Habous"] }, cookie),
    );

    // The session survives, but the account is no longer ACTIVE.
    const board = await SELF.fetch("https://x/api/deliveries/available", { headers: { cookie } });
    expect(board.status).toBe(401);
  });

  it("rejects an application with no zones or an unknown vehicle", async () => {
    const { cookie } = await registerVisitor();

    const noZones = await SELF.fetch(
      "https://x/api/deliverer/apply",
      post({ vehicle: "Scooter", city: "Casablanca", zones: [] }, cookie),
    );
    expect(noZones.status).toBe(400);

    const badVehicle = await SELF.fetch(
      "https://x/api/deliverer/apply",
      post({ vehicle: "Hélicoptère", city: "Casablanca", zones: ["Habous"] }, cookie),
    );
    expect(badVehicle.status).toBe(400);
  });
});
