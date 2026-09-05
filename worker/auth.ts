import { drizzle } from "drizzle-orm/d1";
import { eq, and, gt } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { users, sessions, type User } from "./schema";
import type { AppEnv } from "./types";

export const db = (env: Env) => drizzle(env.DB, { schema: { users, sessions } });

const COOKIE = "qsid";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const PBKDF2_ITERATIONS = 100_000; // Workers caps PBKDF2 iterations at 100k

/**
 * Workers have no bcrypt/argon2 — WebCrypto PBKDF2 is the native option.
 * Format: pbkdf2$<iterations>$<salt-b64>$<hash-b64>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iters, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || !iters || !saltB64 || !hashB64) return false;
  const salt = unb64(saltB64);
  const bits = new Uint8Array(await derive(password, salt, Number(iters)));
  const expected = unb64(hashB64);
  if (bits.length !== expected.length) return false;
  // Constant-time compare: never leak how much of the hash matched.
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i]! ^ expected[i]!;
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function startSession(c: { env: Env; res: Response } & any, userId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const [row] = await db(c.env).insert(sessions).values({ userId, expiresAt }).returning();
  setCookie(c, COOKIE, row!.id, {
    httpOnly: true,
    secure: c.env.APP_ENV !== "development",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export async function endSession(c: any) {
  const sid = getCookie(c, COOKIE);
  if (sid) await db(c.env).delete(sessions).where(eq(sessions.id, sid));
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Populates `c.var.user` when a valid session cookie is present. Never throws. */
export const withUser = createMiddleware<AppEnv>(async (c, next) => {
  const sid = getCookie(c, COOKIE);
  if (sid) {
    const [row] = await db(c.env)
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, Math.floor(Date.now() / 1000))))
      .limit(1);
    if (row && row.user.status === "ACTIVE") c.set("user", row.user);
  }
  await next();
});

/** Gate a route on authentication, optionally on role. Must run after withUser. */
export const requireRole = (...roles: User["role"][]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) throw new HTTPException(401, { message: "authentication required" });
    if (roles.length && !roles.includes(user.role)) {
      throw new HTTPException(403, { message: "insufficient role" });
    }
    await next();
  });
