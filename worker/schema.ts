import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Money is stored as integer minor units (centimes MAD) — never floats.
 * Timestamps are unix seconds so D1/SQLite can index them cheaply.
 */
const now = () => Math.floor(Date.now() / 1000);
const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => integer("created_at").notNull().$defaultFn(now);

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").unique(),
  phone: text("phone").unique(),
  passwordHash: text("password_hash"),
  name: text("name").notNull(),
  role: text("role", { enum: ["CUSTOMER", "STORE_OWNER", "DELIVERER", "ADMIN"] })
    .notNull()
    .default("CUSTOMER"),
  status: text("status", { enum: ["ACTIVE", "PENDING", "SUSPENDED"] })
    .notNull()
    .default("ACTIVE"),
  avatarKey: text("avatar_key"),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const addresses = sqliteTable(
  "addresses",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label"),
    line1: text("line1").notNull(),
    city: text("city").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("addresses_user_idx").on(t.userId)],
);

/** A qissaria / souk — the geographic anchor of the marketplace. */
export const markets = sqliteTable(
  "markets",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    nameAr: text("name_ar"),
    city: text("city").notNull(),
    description: text("description"),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    coverKey: text("cover_key"),
    status: text("status", { enum: ["ACTIVE", "HIDDEN"] })
      .notNull()
      .default("ACTIVE"),
    /**
     * P1 scale: denormalized count of ACTIVE stores. Replaces the per-row
     * `(select count(*) ...)` subquery in catalog bounds/admin lists, which is
     * O(N) subqueries. Maintained by SQLite triggers (see 0006 migration).
     */
    storeCount: integer("store_count").notNull().default(0),
    createdAt: createdAt(),
  },
  // Bounding-box queries filter lat then lng — one composite index serves both.
  (t) => [index("markets_geo_idx").on(t.lat, t.lng), index("markets_city_idx").on(t.city)],
);

export const stores = sqliteTable(
  "stores",
  {
    id: id(),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    phone: text("phone"),
    logoKey: text("logo_key"),
    /** Primary trade, e.g. "Textile" — free text, as the design's field is. */
    category: text("category"),
    /** Registre de commerce; what an admin actually checks before approving. */
    registryNumber: text("registry_number"),
    lat: real("lat"),
    lng: real("lng"),
    status: text("status", { enum: ["ACTIVE", "PENDING", "CLOSED"] })
      .notNull()
      .default("PENDING"),
    createdAt: createdAt(),
  },
  (t) => [index("stores_market_idx").on(t.marketId), index("stores_owner_idx").on(t.ownerId)],
);

export const categories = sqliteTable(
  "categories",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    parentId: text("parent_id"),
  },
  (t) => [index("categories_parent_idx").on(t.parentId)],
);

export const products = sqliteTable(
  "products",
  {
    id: id(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id),
    name: text("name").notNull(),
    description: text("description"),
    /** Minor units (centimes). 4900 = 49.00 MAD. */
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull().default("MAD"),
    stock: integer("stock").notNull().default(0),
    imageKey: text("image_key"),
    status: text("status", { enum: ["ACTIVE", "DRAFT", "ARCHIVED"] })
      .notNull()
      .default("DRAFT"),
    createdAt: createdAt(),
  },
  (t) => [index("products_store_idx").on(t.storeId), index("products_category_idx").on(t.categoryId)],
);

/**
 * An option axis on a product — "Couleur", "Taille". `values` is a JSON array
 * of strings rather than a child table: the list is short, always read whole,
 * and never queried across products.
 */
export const productOptions = sqliteTable(
  "product_options",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** JSON: ["Rouge","Bleu"] */
    values: text("values", { mode: "json" }).$type<string[]>().notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("product_options_product_idx").on(t.productId)],
);

/**
 * One buyable combination. Price and stock live here, not on the product, so a
 * large size can cost more and sell out on its own.
 */
export const productVariants = sqliteTable(
  "product_variants",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** JSON: {"Couleur":"Rouge","Taille":"M"} */
    options: text("options", { mode: "json" }).$type<Record<string, string>>().notNull(),
    label: text("label").notNull(),
    sku: text("sku"),
    priceMinor: integer("price_minor").notNull(),
    stock: integer("stock").notNull().default(0),
  },
  (t) => [index("product_variants_product_idx").on(t.productId)],
);

export const carts = sqliteTable(
  "carts",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [index("carts_user_idx").on(t.userId), index("carts_created_idx").on(t.createdAt)],
);

export const cartItems = sqliteTable(
  "cart_items",
  {
    id: id(),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /**
     * Empty string, never NULL, for an unvaried product. SQLite treats NULLs as
     * distinct in a unique index, so a nullable column here would let the same
     * line be added twice.
     */
    variantId: text("variant_id").notNull().default(""),
    qty: integer("qty").notNull(),
  },
  (t) => [
    uniqueIndex("cart_items_line_idx").on(t.cartId, t.productId, t.variantId),
    index("cart_items_cart_idx").on(t.cartId),
  ],
);

export const orders = sqliteTable(
  "orders",
  {
    id: id(),
    /** Short human-facing reference shown to customer, store and deliverer. */
    ref: text("ref").notNull().unique(),
    customerId: text("customer_id")
      .notNull()
      .references(() => users.id),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    addressId: text("address_id").references(() => addresses.id),
    subtotalMinor: integer("subtotal_minor").notNull(),
    deliveryFeeMinor: integer("delivery_fee_minor").notNull().default(0),
    totalMinor: integer("total_minor").notNull(),
    currency: text("currency").notNull().default("MAD"),
    status: text("status", {
      enum: [
        "PENDING",
        "CONFIRMED",
        "PREPARING",
        "READY",
        "IN_TRANSIT",
        "DELIVERED",
        "CANCELLED",
      ],
    })
      .notNull()
      .default("PENDING"),
    paymentMethod: text("payment_method", { enum: ["COD", "CARD"] })
      .notNull()
      .default("COD"),
    paymentStatus: text("payment_status", { enum: ["UNPAID", "PAID", "REFUNDED"] })
      .notNull()
      .default("UNPAID"),
    /**
     * P1 scale: client-supplied `Idempotency-Key` header. Retries and double
     * taps reuse the same key, so a retried checkout returns the original
     * order instead of charging stock twice. Globally unique, nullable so
     * old rows and key-less checkouts keep working.
     */
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("orders_customer_idx").on(t.customerId),
    index("orders_store_idx").on(t.storeId, t.status),
  ],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    variantId: text("variant_id"),
    /** Denormalised: an order must survive the product being renamed or repriced. */
    name: text("name").notNull(),
    /** e.g. "Rouge · M", frozen at purchase time. */
    variantLabel: text("variant_label"),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    qty: integer("qty").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

export const deliveries = sqliteTable(
  "deliveries",
  {
    id: id(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    delivererId: text("deliverer_id").references(() => users.id),
    status: text("status", {
      enum: ["UNASSIGNED", "ASSIGNED", "PICKED_UP", "DELIVERED", "FAILED"],
    })
      .notNull()
      .default("UNASSIGNED"),
    proofKey: text("proof_key"),
    acceptedAt: integer("accepted_at"),
    deliveredAt: integer("delivered_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("deliveries_order_idx").on(t.orderId),
    index("deliveries_deliverer_idx").on(t.delivererId, t.status),
    index("deliveries_status_idx").on(t.status),
  ],
);

/**
 * What a deliverer submits when applying. Kept apart from `users` because it
 * only exists for one role and an admin reviews it as a unit.
 */
export const delivererProfiles = sqliteTable("deliverer_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  vehicle: text("vehicle").notNull(),
  plate: text("plate"),
  idNumber: text("id_number"),
  idDocKey: text("id_doc_key"),
  city: text("city").notNull(),
  /** JSON: ["Habous","Maârif"] */
  zones: text("zones", { mode: "json" }).$type<string[]>().notNull(),
  availability: text("availability"),
  createdAt: createdAt(),
});

/**
 * "Mon marché n'est pas dans la liste — le proposer". A merchant whose souk is
 * missing must not be blocked from applying, so the request is queued for an
 * admin instead of silently dropped.
 */
export const marketRequests = sqliteTable(
  "market_requests",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    city: text("city").notNull(),
    note: text("note"),
    status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED"] })
      .notNull()
      .default("PENDING"),
    createdAt: createdAt(),
  },
  (t) => [index("market_requests_status_idx").on(t.status)],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storeId: text("store_id").references(() => stores.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    body: text("body"),
    createdAt: createdAt(),
  },
  (t) => [index("reviews_store_idx").on(t.storeId), index("reviews_product_idx").on(t.productId)],
);

export type User = typeof users.$inferSelect;
export type Market = typeof markets.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
export type ProductOption = typeof productOptions.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type DelivererProfile = typeof delivererProfiles.$inferSelect;
export type MarketRequest = typeof marketRequests.$inferSelect;

/**
 * One-time password-reset tokens.
 *
 * There is no email binding on this Worker, so these are issued by an admin
 * from the Users tab and handed to the person out of band (phone, WhatsApp).
 * Only the hash is stored: a leaked database should not hand over live reset
 * links, exactly as with a password.
 */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("password_resets_user_idx").on(t.userId),
    index("password_resets_expires_idx").on(t.expiresAt),
  ],
);
