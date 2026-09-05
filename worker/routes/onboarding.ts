import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { users, stores, markets, delivererProfiles, marketRequests } from "../schema";
import { requireRole } from "../auth";
import { slugify } from "../slug";
import { sellerApplicationSchema, delivererApplicationSchema, marketRequestSchema } from "../../shared/validation";
import type { AppEnv } from "../types";

export const onboarding = new Hono<AppEnv>();

const db = (env: Env) => drizzle(env.DB);



/**
 * Merchant application, submitted at the end of the four-step wizard.
 *
 * The caller must already be signed in — step 1 of the wizard registers the
 * account, so by the time this runs there is a user to attach the shop to. A
 * CUSTOMER who applies is promoted to STORE_OWNER here; that is the only way
 * the role ever changes without an admin.
 */
onboarding.post(
  "/seller/apply",
  requireRole(),
  zValidator("json", sellerApplicationSchema),
  async (c) => {
    const user = c.get("user")!;
    const input = c.req.valid("json");
    const d = db(c.env);

    if (user.role === "DELIVERER" || user.role === "ADMIN") {
      throw new HTTPException(409, { message: "this account cannot open a shop" });
    }

    const [market] = await d.select({ id: markets.id }).from(markets).where(eq(markets.id, input.marketId));
    if (!market) throw new HTTPException(400, { message: "unknown market" });

    // Slug must be unique across the platform; fall back to a suffix rather
    // than failing an otherwise complete application.
    const base = slugify(input.name) || "boutique";
    const taken = await d.select({ slug: stores.slug }).from(stores).where(eq(stores.slug, base));
    const slug = taken.length ? `${base}-${Date.now().toString(36).slice(-4)}` : base;

    const [store] = await d
      .insert(stores)
      .values({
        marketId: input.marketId,
        ownerId: user.id,
        slug,
        name: input.name,
        description: input.description ?? null,
        phone: input.phone ?? null,
        logoKey: input.logoKey ?? null,
        category: input.category ?? null,
        registryNumber: input.registryNumber ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        // Every shop is reviewed before it is visible to customers.
        status: "PENDING",
      })
      .returning();

    if (user.role === "CUSTOMER") {
      await d.update(users).set({ role: "STORE_OWNER" }).where(eq(users.id, user.id));
    }

    return c.json({ store }, 201);
  },
);

/** Deliverer application — the equivalent final step of the deliverer wizard. */
onboarding.post(
  "/deliverer/apply",
  requireRole(),
  zValidator("json", delivererApplicationSchema),
  async (c) => {
    const user = c.get("user")!;
    const input = c.req.valid("json");
    const d = db(c.env);

    if (user.role === "STORE_OWNER" || user.role === "ADMIN") {
      throw new HTTPException(409, { message: "this account cannot deliver" });
    }

    await d
      .insert(delivererProfiles)
      .values({
        userId: user.id,
        vehicle: input.vehicle,
        plate: input.plate ?? null,
        idNumber: input.idNumber ?? null,
        city: input.city,
        zones: input.zones,
        availability: input.availability ?? null,
      })
      // Re-applying updates the file rather than erroring on the primary key.
      .onConflictDoUpdate({
        target: delivererProfiles.userId,
        set: {
          vehicle: input.vehicle,
          plate: input.plate ?? null,
          idNumber: input.idNumber ?? null,
          city: input.city,
          zones: input.zones,
          availability: input.availability ?? null,
        },
      });

    // A deliverer waits for an admin before they can take any job.
    await d
      .update(users)
      .set({ role: "DELIVERER", status: "PENDING" })
      .where(eq(users.id, user.id));

    return c.json({ ok: true }, 201);
  },
);

onboarding.get("/deliverer/me", requireRole(), async (c) => {
  const [profile] = await db(c.env)
    .select()
    .from(delivererProfiles)
    .where(eq(delivererProfiles.userId, c.get("user")!.id));
  return c.json({ profile: profile ?? null });
});

/** A merchant whose souk is not listed proposes it rather than being blocked. */
onboarding.post(
  "/market-requests",
  requireRole(),
  zValidator("json", marketRequestSchema),
  async (c) => {
    const [request] = await db(c.env)
      .insert(marketRequests)
      .values({ ...c.req.valid("json"), userId: c.get("user")!.id })
      .returning();
    return c.json({ request }, 201);
  },
);

onboarding.get("/admin/market-requests", requireRole("ADMIN"), async (c) => {
  const rows = await db(c.env)
    .select({
      id: marketRequests.id,
      name: marketRequests.name,
      city: marketRequests.city,
      note: marketRequests.note,
      status: marketRequests.status,
      createdAt: marketRequests.createdAt,
      requestedBy: users.name,
    })
    .from(marketRequests)
    .innerJoin(users, eq(users.id, marketRequests.userId))
    .orderBy(desc(marketRequests.createdAt))
    .limit(100);
  return c.json({ requests: rows });
});

onboarding.post(
  "/admin/market-requests/:id",
  requireRole("ADMIN"),
  zValidator("json", z.object({ status: z.enum(["APPROVED", "REJECTED"]) })),
  async (c) => {
    await db(c.env)
      .update(marketRequests)
      .set({ status: c.req.valid("json").status })
      .where(eq(marketRequests.id, c.req.param("id")));
    return c.json({ ok: true });
  },
);
