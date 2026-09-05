import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../worker/schema";
import { hashPassword } from "../worker/auth";

const db = () => drizzle(env.DB);
const PW = "correct-horse-battery";

async function signInAs(role: "CUSTOMER" | "STORE_OWNER") {
  const email = `${role}-${crypto.randomUUID()}@x.ma`;
  await db()
    .insert(users)
    .values({ name: role, email, role, status: "ACTIVE", passwordHash: await hashPassword(PW) });
  const res = await SELF.fetch("https://x/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

const bytes = (...parts: (number[] | string)[]) => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") out.push(...[...p].map((ch) => ch.charCodeAt(0)));
    else out.push(...p);
  }
  return new Uint8Array(out);
};

/** Minimal but genuine leading bytes for each accepted format. */
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ", new Array(16).fill(0));
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], new Array(16).fill(0));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], new Array(16).fill(0));

const upload = (body: Uint8Array, cookie: string, type = "image/webp", prefix = "products") =>
  SELF.fetch(`https://x/api/media/${prefix}`, {
    method: "POST",
    headers: { "content-type": type, cookie },
    body,
  });

describe("media upload validation", () => {
  it("accepts a real WebP and keys it by its signature", async () => {
    const cookie = await signInAs("STORE_OWNER");
    const res = await upload(WEBP, cookie);
    expect(res.status).toBe(201);

    const { key, url } = (await res.json()) as { key: string; url: string };
    expect(key).toMatch(/^products\/[0-9a-f-]{36}\.webp$/);
    expect(url).toContain(key);

    // Round-trips through R2 with the sniffed type, not the claimed one.
    const back = await SELF.fetch(`https://x/api/media/${key}`);
    expect(back.status).toBe(200);
    expect(back.headers.get("content-type")).toBe("image/webp");
  });

  it("accepts JPEG and PNG, naming the extension from the bytes", async () => {
    const cookie = await signInAs("STORE_OWNER");

    const jpeg = await upload(JPEG, cookie, "image/jpeg");
    expect(jpeg.status).toBe(201);
    expect(((await jpeg.json()) as { key: string }).key).toMatch(/\.jpg$/);

    const png = await upload(PNG, cookie, "image/png");
    expect(png.status).toBe(201);
    expect(((await png.json()) as { key: string }).key).toMatch(/\.png$/);
  });

  it("rejects a non-image that merely claims to be one", async () => {
    const cookie = await signInAs("STORE_OWNER");
    // The header says WebP; the bytes are a script. Trusting the header would
    // store this under an image URL we later serve back.
    const payload = new TextEncoder().encode("<script>alert(1)</script>--------");
    const res = await upload(payload, cookie);
    expect(res.status).toBe(415);
  });

  it("rejects a real image whose declared type contradicts its bytes", async () => {
    const cookie = await signInAs("STORE_OWNER");
    const res = await upload(PNG, cookie, "image/webp");
    expect(res.status).toBe(415);
  });

  it("rejects an empty body and an over-sized one", async () => {
    const cookie = await signInAs("STORE_OWNER");
    expect((await upload(new Uint8Array(0), cookie)).status).toBe(400);

    const huge = new Uint8Array(5 * 1024 * 1024 + 1024);
    huge.set(WEBP);
    expect((await upload(huge, cookie)).status).toBe(413);
  });

  it("rejects an unknown prefix and an unauthorised role", async () => {
    const owner = await signInAs("STORE_OWNER");
    expect((await upload(WEBP, owner, "image/webp", "invoices")).status).toBe(400);
    // Traversal never even reaches the handler — the router normalises it away.
    expect((await upload(WEBP, owner, "image/webp", "../secrets")).status).toBe(404);

    const customer = await signInAs("CUSTOMER");
    expect((await upload(WEBP, customer)).status).toBe(403);

    const res = await SELF.fetch("https://x/api/media/products", {
      method: "POST",
      headers: { "content-type": "image/webp" },
      body: WEBP,
    });
    expect(res.status).toBe(401);
  });
});

describe("media permissions per prefix", () => {
  it("lets any signed-in account upload its own avatar", async () => {
    const cookie = await signInAs("CUSTOMER");
    const res = await upload(WEBP, cookie, "image/webp", "avatars");
    expect(res.status).toBe(201);
    expect(((await res.json()) as { key: string }).key).toMatch(/^avatars\//);
  });

  it("keeps market imagery to administrators", async () => {
    const owner = await signInAs("STORE_OWNER");
    // A shopkeeper must not be able to replace a whole souk's banner.
    expect((await upload(WEBP, owner, "image/webp", "markets")).status).toBe(403);
  });

  it("keeps delivery proofs to couriers", async () => {
    const owner = await signInAs("STORE_OWNER");
    expect((await upload(WEBP, owner, "image/webp", "delivery-proofs")).status).toBe(403);
  });

  it("keeps product and store imagery away from customers", async () => {
    const customer = await signInAs("CUSTOMER");
    expect((await upload(WEBP, customer, "image/webp", "products")).status).toBe(403);
    expect((await upload(WEBP, customer, "image/webp", "stores")).status).toBe(403);
  });
});
