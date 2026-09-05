import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { users, stores, markets, products, deliveries } from "./schema";

/**
 * Removing an image that has been replaced.
 *
 * Doing this naively is destructive. `mediaKey` validates a key's *shape*, not
 * who owns it, so anyone could point their avatar at another account's image
 * and then clear it — deleting a file they never uploaded. Rather than trusting
 * the caller, every deletion first proves the object is referenced by nothing
 * at all. An orphan is safe to remove; anything still in use is left alone.
 */
async function isReferenced(env: Env, key: string): Promise<boolean> {
  const d = drizzle(env.DB);
  const count = sql<number>`count(*)`;

  // One batch, five tables — every column in the schema that stores a key.
  const [avatars, logos, covers, images, proofs] = await d.batch([
    d.select({ n: count }).from(users).where(eq(users.avatarKey, key)),
    d.select({ n: count }).from(stores).where(eq(stores.logoKey, key)),
    d.select({ n: count }).from(markets).where(eq(markets.coverKey, key)),
    d.select({ n: count }).from(products).where(eq(products.imageKey, key)),
    d.select({ n: count }).from(deliveries).where(eq(deliveries.proofKey, key)),
  ]);

  return [avatars, logos, covers, images, proofs].some((rows) => (rows[0]?.n ?? 0) > 0);
}

/**
 * Call *after* the row has been updated, so the reference check sees the new
 * state and no longer counts the record that just let go of the key.
 *
 * The work is handed to `waitUntil`: a slow or failing R2 delete must never
 * turn a successful save into an error for the person who made it. A leaked
 * object costs a fraction of a centime; a failed save costs their edit.
 */
export function releaseMedia(
  // Structural, not Hono's or the runtime's ExecutionContext: the two differ
  // and this only ever needs waitUntil.
  c: { env: Env; executionCtx?: { waitUntil(promise: Promise<unknown>): void } },
  previousKey: string | null | undefined,
  nextKey: string | null | undefined,
) {
  if (!previousKey || previousKey === nextKey) return;

  const work = (async () => {
    try {
      if (await isReferenced(c.env, previousKey)) return;
      await c.env.MEDIA.delete(previousKey);
    } catch (err) {
      // Worth knowing about, never worth failing the request over.
      console.error("media cleanup failed", previousKey, err);
    }
  })();

  // `executionCtx` is absent in some test harnesses; awaiting inline is fine there.
  if (c.executionCtx) c.executionCtx.waitUntil(work);
  else void work;
}
