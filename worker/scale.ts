import { drizzle } from "drizzle-orm/d1";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { carts, passwordResets, sessions } from "./schema";

// ---------------------------------------------------------------------------
// Scheduled cleanup (Cron Trigger).
//
// D1 is the scaling ceiling: sessions, guest carts and spent reset tokens grow
// monotonically unless something deletes them. Run daily via
// `triggers.crons` in wrangler.jsonc — see `scheduled()` in worker/index.ts.
// ---------------------------------------------------------------------------

const GUEST_CART_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches qcart cookie

export async function runCleanup(env: Env): Promise<{
  sessions: number;
  carts: number;
  resets: number;
}> {
  const d = drizzle(env.DB);
  const now = Math.floor(Date.now() / 1000);

  // 1. Expired sessions. Every request joins sessions+users (withUser), so an
  // unbounded table slows down auth for everyone.
  const expiredSessions = await d.delete(sessions).where(lt(sessions.expiresAt, now)).returning({
    id: sessions.id,
  });

  // 2. Orphan guest carts: ownerless and older than the cookie TTL. Deleting
  // the cart cascades to cart_items (FK onDelete cascade).
  const cutoff = now - GUEST_CART_TTL_SECONDS;
  const staleCarts = await d
    .delete(carts)
    .where(and(isNull(carts.userId), lt(carts.createdAt, cutoff)))
    .returning({ id: carts.id });

  // 3. Spent or expired password-reset tokens. The raw token is never stored,
  // so this is just hygiene — keeps the table small and the
  // password/forgot throttle check (which scans by user) cheap.
  const staleResets = await d
    .delete(passwordResets)
    .where(or(lt(passwordResets.expiresAt, now), sql`${passwordResets.usedAt} IS NOT NULL`))
    .returning({ id: passwordResets.id });

  // eq import is kept for callers that build on this module; carts.userId null
  // check above uses isNull explicitly.
  void eq;
  return { sessions: expiredSessions.length, carts: staleCarts.length, resets: staleResets.length };
}

// ---------------------------------------------------------------------------
// Edge caching for public catalog reads.
//
// D1 reads are billed and slow under load; catalog data changes rarely (a
// merchant edit, an admin approval). Cache public GETs in Cloudflare's cache
// for 60s with stale-while-revalidate so repeated map pans don't hit D1.
// Authenticated / mutated routes must never use this.
// ---------------------------------------------------------------------------

export async function cachedJson<T>(
  req: Request,
  // Hono context is structural here to avoid importing hono types in tests.
  c: { executionCtx?: { waitUntil(p: Promise<unknown>): void } },
  ttlSeconds: number,
  producer: () => Promise<T>,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(req.url, { method: "GET" });
  const hit = await cache.match(cacheKey).catch(() => undefined);
  if (hit) return hit;

  const data = await producer();
  const res = Response.json(data, {
    headers: {
      "cache-control": `public, max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 5}`,
      ...extraHeaders,
    },
  });
  // Clone before put: a Response body can only be read once.
  const put = cache.put(cacheKey, res.clone()).catch((err) => {
    console.error("catalog cache put failed", err);
  });
  if (c.executionCtx) c.executionCtx.waitUntil(put);
  else await put;
  return res;
}

// ---------------------------------------------------------------------------
// Abuse protection: Rate Limit binding (if configured) + Turnstile (optional).
//
// Preferred enforcement is Cloudflare dashboard Rate Limit rules + WAF on
// /api/auth/*, /api/orders, /api/search, /api/media/* — no code to maintain.
// This helper is the in-code backstop: when a `RATE_LIMITER` binding exists
// (Workers Paid, `ratelimits` in wrangler.jsonc) it is consulted; otherwise it
// silently allows so local dev and tests keep working without config.
// ---------------------------------------------------------------------------

type RateLimiterBinding = {
  limit: (opts: { key: string }) => Promise<{ success: boolean }>;
};

export async function checkRateLimit(
  env: Env,
  key: string,
): Promise<{ limited: boolean }> {
  const limiter = (env as unknown as Record<string, RateLimiterBinding | undefined>)["RATE_LIMITER"];
  if (!limiter?.limit) return { limited: false };
  try {
    const { success } = await limiter.limit({ key });
    return { limited: !success };
  } catch (err) {
    // A failing limiter must fail open for availability, but loudly.
    console.error("rate limiter error", err);
    return { limited: false };
  }
}

/**
 * Verifies a Turnstile token when a secret is configured. Returns true when
 * verification is skipped (no secret — local dev / tests) so callers don't
 * branch. Wire `turnstileToken` through register/login when you enable it in
 * the client; until then the auth routes simply don't send one and this is a
 * no-op.
 */
export async function verifyTurnstile(env: Env, token: string | undefined): Promise<boolean> {
  const secret = (env as unknown as Record<string, string | undefined>)["TURNSTILE_SECRET_KEY"];
  if (!secret) return true;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
    return body?.success === true;
  } catch (err) {
    console.error("turnstile verify failed", err);
    return false;
  }
}
