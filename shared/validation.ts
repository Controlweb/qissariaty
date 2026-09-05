import { z } from "zod";

/**
 * Single source of truth for request shapes. The worker validates with these at
 * the trust boundary; the React app imports the inferred types so a route and
 * its caller cannot drift apart.
 */

export const Role = z.enum(["CUSTOMER", "STORE_OWNER", "DELIVERER", "ADMIN"]);

export const OrderStatus = z.enum([
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
]);

export const DeliveryStatus = z.enum([
  "UNASSIGNED",
  "ASSIGNED",
  "PICKED_UP",
  "DELIVERED",
  "FAILED",
]);

/** Morocco-ish sanity bounds — rejects swapped lat/lng and junk coordinates. */
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/** An R2 object key, as returned by POST /api/media/:prefix. */
export const mediaKey = z
  .string()
  .trim()
  .max(120)
  .regex(
    /^(products|stores|markets|avatars|delivery-proofs)\/[0-9a-f-]{36}\.(webp|jpg|png|avif)$/,
    "invalid media key",
  );

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email(),
  password: z.string().min(8).max(200),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{8,20}$/, "invalid phone")
    .optional(),
  role: Role.exclude(["ADMIN"]).default("CUSTOMER"),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

/**
 * Map viewport query. Capped so a zoomed-out map cannot ask for all of Morocco.
 * Coerced, not plain numbers: this one arrives as a query string.
 */
export const boundsSchema = z
  .object({
    north: z.coerce.number().pipe(lat),
    south: z.coerce.number().pipe(lat),
    east: z.coerce.number().pipe(lng),
    west: z.coerce.number().pipe(lng),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine((b) => b.north > b.south, { message: "north must exceed south" })
  .refine((b) => b.north - b.south <= 2 && Math.abs(b.east - b.west) <= 2, {
    message: "viewport too large; zoom in",
  });

export const marketQuerySchema = z.object({
  city: z.string().trim().min(1).max(80).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const searchSchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const addressSchema = z.object({
  label: z.string().trim().max(40).optional(),
  line1: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(80),
  lat,
  lng,
  notes: z.string().trim().max(300).optional(),
});

export const storeSchema = z.object({
  marketId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case"),
  description: z.string().trim().max(2000).optional(),
  phone: z.string().trim().max(20).optional(),
  lat: lat.optional(),
  lng: lng.optional(),
});

/** Final submit of the four-step merchant wizard. */
export const sellerApplicationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  marketId: z.uuid(),
  logoKey: mediaKey.optional(),
  category: z.string().trim().max(60).optional(),
  registryNumber: z.string().trim().max(40).optional(),
  description: z.string().trim().max(2000).optional(),
  phone: z.string().trim().max(20).optional(),
  lat,
  lng,
});

/** Final submit of the four-step deliverer wizard. */
export const delivererApplicationSchema = z.object({
  vehicle: z.enum(["À pied", "Vélo", "Scooter", "Moto", "Voiture"]),
  plate: z.string().trim().max(20).optional(),
  idNumber: z.string().trim().max(30).optional(),
  city: z.string().trim().min(2).max(80),
  zones: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
  availability: z.string().trim().max(120).optional(),
});

export const marketRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  note: z.string().trim().max(500).optional(),
});

/** Merchant edits to their own shop. Every field optional — this is a patch. */
export const storeUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  phone: z.string().trim().max(20).optional(),
  category: z.string().trim().max(60).optional(),
  logoKey: mediaKey.nullable().optional(),
});

/** What a person may change about themselves. Role and status are not here. */
export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(20).optional(),
  avatarKey: mediaKey.nullable().optional(),
});

/**
 * Everything an admin may change about a souk. The table has carried nameAr,
 * city and coordinates since the first migration; only the cover was ever
 * reachable, which left a mistyped city or a misplaced pin unfixable.
 */
export const marketUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  nameAr: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  lat: lat.optional(),
  lng: lng.optional(),
  coverKey: mediaKey.nullable().optional(),
  status: z.enum(["ACTIVE", "HIDDEN"]).optional(),
});

/** A new souk. Name, city and a pin are the minimum that makes it findable. */
export const marketCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  lat,
  lng,
  nameAr: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  coverKey: mediaKey.nullable().optional(),
  status: z.enum(["ACTIVE", "HIDDEN"]).default("ACTIVE"),
});

/** Proof of delivery: a photo left at the door, the recipient, the parcel. */
export const deliveredSchema = z.object({
  proofKey: mediaKey.nullable().optional(),
});

export const productSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional(),
  /** Minor units. Integer-only: 49.5 centimes does not exist. */
  priceMinor: z.number().int().min(1).max(100_000_000),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  categoryId: z.uuid().optional(),
  imageKey: mediaKey.optional(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("DRAFT"),
});

/** Editing an existing product. Every field optional; status covers archiving. */
export const productUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  priceMinor: z.number().int().min(1).max(100_000_000).optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  categoryId: z.uuid().nullable().optional(),
  imageKey: mediaKey.nullable().optional(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
});

/**
 * Setting your own password. `current` is required only when one already
 * exists — a guest account created at checkout has no hash, and demanding a
 * password it never had would lock the owner out of their own account.
 */
export const passwordSetSchema = z.object({
  current: z.string().min(1).max(200).optional(),
  password: z.string().min(8).max(200),
});

/** Redeeming a one-time reset token issued by an admin. */
export const passwordResetSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(200),
});

export const cartItemSchema = z.object({
  productId: z.uuid(),
  /** Empty string, never absent, when the product has no variants. */
  variantId: z.string().max(40).default(""),
  qty: z.number().int().min(1).max(99),
});

/** Replaces a product's whole option/variant set in one call. */
export const variantsSchema = z.object({
  options: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        values: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
      }),
    )
    .max(3),
  variants: z
    .array(
      z.object({
        options: z.record(z.string(), z.string()),
        sku: z.string().trim().max(40).optional(),
        priceMinor: z.number().int().min(1).max(100_000_000),
        stock: z.number().int().min(0).max(1_000_000).default(0),
      }),
    )
    .max(100),
});

/** Quantity stepper. 0 is allowed and means "remove this line". */
export const cartQtySchema = z.object({
  qty: z.number().int().min(0).max(99),
});

/**
 * Checkout accepts either a saved address (signed in) or a full one inline
 * (guest), and carries guest identity when there is no session.
 */
export const createOrderSchema = z
  .object({
    addressId: z.uuid().optional(),
    address: addressSchema.optional(),
    guest: z
      .object({
        name: z.string().trim().min(2).max(80),
        email: z.email(),
        phone: z
          .string()
          .trim()
          .regex(/^\+?[0-9\s-]{8,20}$/, "invalid phone")
          .optional(),
        /** Optional: set one now and the account is usable immediately. */
        password: z.string().min(8).max(200).optional(),
      })
      .optional(),
    paymentMethod: z.enum(["COD", "CARD"]).default("COD"),
    note: z.string().trim().max(500).optional(),
  })
  .refine((o) => !!o.addressId !== !!o.address, {
    message: "provide exactly one of addressId or address",
  });

export const delivererLocationSchema = z.object({
  lat,
  lng,
  heading: z.number().min(0).max(360).optional(),
});

export const reviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(2000).optional(),
    storeId: z.uuid().optional(),
    productId: z.uuid().optional(),
  })
  // A review with no subject is meaningless, and one with two is ambiguous.
  .refine((r) => !!r.storeId !== !!r.productId, {
    message: "provide exactly one of storeId or productId",
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type Bounds = z.infer<typeof boundsSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type StoreInput = z.infer<typeof storeSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type SellerApplication = z.infer<typeof sellerApplicationSchema>;
export type DelivererApplication = z.infer<typeof delivererApplicationSchema>;
