import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { users, sessions, passwordResets } from "../schema";
import { db, hashPassword, verifyPassword, startSession, endSession, withUser } from "../auth";
import { claimGuestCart } from "./commerce";
import {
  registerSchema,
  loginSchema,
  passwordSetSchema,
  passwordResetSchema,
} from "../../shared/validation";
import { checkRateLimit, verifyTurnstile } from "../scale";
import type { AppEnv } from "../types";

export const auth = new Hono<AppEnv>();

const publicUser = (u: {
  id: string;
  name: string;
  email: string | null;
  role: string;
  avatarKey?: string | null;
  phone?: string | null;
  passwordHash?: string | null;
}) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  avatarKey: u.avatarKey ?? null,
  phone: u.phone ?? null,
  // Never the hash itself — only whether one exists, so the account page knows
  // whether to ask for a current password or to offer setting a first one.
  hasPassword: !!u.passwordHash,
});

auth.post("/register", zValidator("json", registerSchema), async (c) => {
  const input = c.req.valid("json");
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if ((await checkRateLimit(c.env, `register:${ip}`)).limited) {
    throw new HTTPException(429, { message: "too many attempts, try again later" });
  }
  if (!(await verifyTurnstile(c.env, input.turnstileToken))) {
    throw new HTTPException(403, { message: "captcha verification failed" });
  }
  const d = db(c.env);

  const [existing] = await d.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (existing) throw new HTTPException(409, { message: "email already registered" });

  const [user] = await d
    .insert(users)
    .values({
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      role: input.role,
      passwordHash: await hashPassword(input.password),
      // Store owners and deliverers are vetted before they can trade.
      status: input.role === "CUSTOMER" ? "ACTIVE" : "PENDING",
    })
    .returning();

  if (user!.status === "ACTIVE") {
    await startSession(c, user!.id);
    await claimGuestCart(c, user!.id);
  }
  return c.json({ user: publicUser(user!) }, 201);
});

auth.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password, turnstileToken } = c.req.valid("json");
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if ((await checkRateLimit(c.env, `login:${ip}`)).limited) {
    throw new HTTPException(429, { message: "too many attempts, try again later" });
  }
  if (!(await verifyTurnstile(c.env, turnstileToken))) {
    throw new HTTPException(403, { message: "captcha verification failed" });
  }
  const [user] = await db(c.env).select().from(users).where(eq(users.email, email)).limit(1);

  // Same response for unknown email and wrong password: do not confirm which
  // addresses have accounts.
  const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
  if (!ok || !user) throw new HTTPException(401, { message: "invalid credentials" });
  if (user.status !== "ACTIVE") throw new HTTPException(403, { message: `account ${user.status.toLowerCase()}` });

  await startSession(c, user.id);
  // Signing in mid-shop keeps whatever was already in the basket.
  await claimGuestCart(c, user.id);
  return c.json({ user: publicUser(user) });
});

auth.post("/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

auth.get("/me", withUser, (c) => {
  const user = c.get("user");
  return c.json({ user: user ? publicUser(user) : null });
});

/**
 * A high-entropy random token, so a fast hash is the right one — unlike a
 * password, there is nothing to brute-force in 256 bits of randomness.
 */
export const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const RESET_TTL_SECONDS = 60 * 60 * 24; // one day

/**
 * Set or change your own password.
 *
 * `current` is demanded only when a hash already exists. Accounts created at
 * checkout have none — the confirmation screen tells those people to "set a
 * password from your account", and until now there was nowhere to do it.
 */
auth.post("/password", withUser, zValidator("json", passwordSetSchema), async (c) => {
  const user = c.get("user");
  if (!user) throw new HTTPException(401, { message: "connectez-vous d'abord" });

  const [row] = await db(c.env).select().from(users).where(eq(users.id, user.id));
  if (row?.passwordHash) {
    const input = c.req.valid("json");
    if (!input.current || !(await verifyPassword(input.current, row.passwordHash))) {
      throw new HTTPException(403, { message: "mot de passe actuel incorrect" });
    }
  }

  await db(c.env)
    .update(users)
    .set({ passwordHash: await hashPassword(c.req.valid("json").password) })
    .where(eq(users.id, user.id));
  return c.json({ ok: true });
});

/** Redeem a reset token. One use, then it is spent. */
auth.post("/password/reset", zValidator("json", passwordResetSchema), async (c) => {
  const { token, password } = c.req.valid("json");
  const now = Math.floor(Date.now() / 1000);
  const d = db(c.env);

  const [reset] = await d
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, await hashToken(token)));

  // One message for every failure mode: a caller probing tokens learns nothing
  // about which ones exist.
  if (!reset || reset.usedAt || reset.expiresAt < now) {
    throw new HTTPException(400, { message: "lien invalide ou expiré" });
  }

  await d.batch([
    d.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, reset.userId)),
    d.update(passwordResets).set({ usedAt: now }).where(eq(passwordResets.id, reset.id)),
    // Any other session on this account is no longer trustworthy.
    d.delete(sessions).where(eq(sessions.userId, reset.userId)),
  ]);

  await startSession(c, reset.userId);
  const [user] = await d.select().from(users).where(eq(users.id, reset.userId));
  return c.json({ user: publicUser(user!) });
});

/** Issues a reset token and stores it. Shared by self-service and admin paths. */
export async function issueResetToken(env: Env, userId: string) {
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expiresAt = Math.floor(Date.now() / 1000) + RESET_TTL_SECONDS;
  const d = db(env);
  await d.batch([
    d.delete(passwordResets).where(eq(passwordResets.userId, userId)),
    d.insert(passwordResets).values({ userId, tokenHash: await hashToken(token), expiresAt }),
  ]);
  return { token, expiresAt };
}

/**
 * Self-service "forgot password".
 *
 * Always answers 200 whether or not the address is on file: a different
 * response for a known account turns this endpoint into a way to enumerate
 * every customer's email. `delivered` reports on the mail configuration, not
 * on the account, so it gives nothing away.
 */
auth.post("/password/forgot", zValidator("json", z.object({ email: z.email() })), async (c) => {
  const { email } = c.req.valid("json");
  const d = db(c.env);

  /*
   * Decided BEFORE the account is looked up, and never touched afterwards.
   *
   * The first version returned `delivered: false` when a send threw, which made
   * the response depend on whether the address was real: a failing send meant
   * the account existed, a silent success meant it did not. In production —
   * where the sending domain is not onboarded yet and every send fails — that
   * turned this endpoint into a clean account-enumeration oracle. Deriving the
   * flag from configuration alone makes that class of leak impossible.
   */
  const configured = !!c.env.EMAIL;

  const [user] = await d.select().from(users).where(eq(users.email, email.toLowerCase().trim()));

  if (user && configured) {
    const now = Math.floor(Date.now() / 1000);
    const [recent] = await d.select().from(passwordResets).where(eq(passwordResets.userId, user.id));

    // One mail a minute per account: enough to survive a double-click, not
    // enough to use this endpoint to bomb someone's inbox.
    const throttled = recent && !recent.usedAt && recent.expiresAt - RESET_TTL_SECONDS > now - 60;
    if (!throttled) {
      const { token } = await issueResetToken(c.env, user.id);
      const link = new URL(`/reinitialiser?token=${token}`, c.req.url).toString();
      try {
        await c.env.EMAIL.send({
          from: c.env.EMAIL_FROM,
          to: user.email!,
          subject: "Réinitialisez votre mot de passe Qissariaty",
          text: `Bonjour ${user.name},

Pour choisir un nouveau mot de passe, ouvrez ce lien :
${link}

Ce lien est valable 24 heures et ne fonctionne qu'une fois. Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.

Qissariaty`,
          html: `<p>Bonjour ${user.name},</p><p>Pour choisir un nouveau mot de passe, ouvrez ce lien :</p><p><a href="${link}">Réinitialiser mon mot de passe</a></p><p>Ce lien est valable 24 heures et ne fonctionne qu'une fois. Si vous n'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.</p><p>Qissariaty</p>`,
        });
      } catch (err) {
        // Logged for the operator, invisible to the caller. The token stays
        // valid: an admin can still hand the same link over by phone.
        console.error("password/forgot send failed", err);
      }
    }
  }

  return c.json({ ok: true, delivered: configured });
});
