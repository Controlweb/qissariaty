import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireRole } from "../auth";
import type { User } from "../schema";
import type { AppEnv } from "../types";

export const media = new Hono<AppEnv>();

/**
 * The client resizes and re-encodes before uploading, so anything arriving here
 * should already be a modest WebP. This ceiling is a backstop against abuse,
 * not the normal path — a 1920px WebP at q80 lands around 300–600 KB.
 */
const MAX_BYTES = 5 * 1024 * 1024;
/**
 * Who may write into each bucket prefix.
 *
 * A single blanket role was wrong in both directions: it barred customers from
 * their own avatar, and let any shopkeeper overwrite market imagery that only
 * an administrator curates.
 */
const PREFIX_ROLES: Record<string, User["role"][]> = {
  // Any signed-in account owns its own picture.
  avatars: [],
  products: ["STORE_OWNER", "ADMIN"],
  stores: ["STORE_OWNER", "ADMIN"],
  markets: ["ADMIN"],
  "delivery-proofs": ["DELIVERER", "ADMIN"],
};

/**
 * Content sniffing. `Content-Type` is a claim by the caller, not evidence, so
 * every upload is checked against the actual leading bytes — otherwise anyone
 * could store an arbitrary payload under an image URL we later serve back.
 */
const SIGNATURES: { type: string; ext: string; match: (b: Uint8Array) => boolean }[] = [
  {
    type: "image/webp",
    ext: "webp",
    // "RIFF" .... "WEBP"
    match: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  },
  {
    type: "image/jpeg",
    ext: "jpg",
    match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    type: "image/png",
    ext: "png",
    match: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    type: "image/avif",
    ext: "avif",
    // ....ftypavif / ftypavis
    match: (b) => ascii(b, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 12)),
  },
];

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

media.post("/media/:prefix", async (c, next) => {
  // Authorisation depends on the prefix, so it is resolved per request rather
  // than pinned to the route.
  const roles = PREFIX_ROLES[c.req.param("prefix")];
  if (!roles) throw new HTTPException(400, { message: "unknown media prefix" });
  return requireRole(...roles)(c, next);
});

media.post("/media/:prefix", async (c) => {
  const prefix = c.req.param("prefix")!;

  // Cheap rejection before reading a body we would only throw away. The header
  // can lie or be absent, so the real length is enforced again below.
  const declaredLength = Number(c.req.header("content-length") ?? 0);
  if (declaredLength > MAX_BYTES) {
    throw new HTTPException(413, { message: `image must be at most ${MAX_BYTES} bytes` });
  }

  const body = new Uint8Array(await c.req.arrayBuffer());
  if (!body.byteLength) throw new HTTPException(400, { message: "empty body" });
  if (body.byteLength > MAX_BYTES) {
    throw new HTTPException(413, { message: `image must be at most ${MAX_BYTES} bytes` });
  }
  if (body.byteLength < 12) throw new HTTPException(415, { message: "not a recognisable image" });

  const signature = SIGNATURES.find((s) => s.match(body));
  if (!signature) {
    throw new HTTPException(415, { message: "file content is not a supported image" });
  }

  // A mismatch means the caller is confused or probing; either way the bytes,
  // not the claim, decide what we store and later serve.
  const declaredType = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  if (declaredType && declaredType !== signature.type) {
    throw new HTTPException(415, {
      message: `content-type ${declaredType} does not match file contents (${signature.type})`,
    });
  }

  const key = `${prefix}/${crypto.randomUUID()}.${signature.ext}`;
  await c.env.MEDIA.put(key, body, {
    httpMetadata: {
      // Taken from the signature, never from the request header.
      contentType: signature.type,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  return c.json({ key, url: `${c.env.MEDIA_PUBLIC_BASE}/${key}` }, 201);
});

/**
 * Fallback read path for local dev and buckets with no public domain. In
 * production, serve R2 through a custom domain so image reads bypass the
 * Worker entirely.
 */
media.get("/media/*", async (c) => {
  const key = c.req.path.replace(/^\/api\/media\//, "");
  const object = await c.env.MEDIA.get(key);
  if (!object) throw new HTTPException(404, { message: "not found" });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Stored keys are opaque UUIDs, but never let a stored type drive sniffing.
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
});
