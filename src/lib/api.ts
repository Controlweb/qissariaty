import type { Market, Store, Product, Order, Delivery } from "../../worker/schema";

/**
 * One fetch wrapper for the whole app. Same-origin, cookie session, and every
 * non-2xx becomes a thrown Error so TanStack Query handles it as an error state
 * instead of caching a failure body as data.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });
const patch = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });

export type MediaPrefix = "products" | "stores" | "markets" | "avatars" | "delivery-proofs";

/**
 * Uploads a single already-optimised image.
 *
 * XHR rather than fetch: fetch exposes no upload progress, and on a Moroccan
 * mobile connection a silent multi-second upload reads as a broken button.
 * The body is the raw bytes — the Worker streams them straight into R2, so
 * there is no multipart envelope to parse.
 */
export function uploadMedia(
  prefix: MediaPrefix,
  file: File,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<{ key: string; url: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/media/${prefix}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", file.type);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: { key?: string; url?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.key && body.url) {
        onProgress?.(1);
        resolve({ key: body.key, url: body.url });
      } else {
        reject(new ApiError(xhr.status, body.error ?? `échec de l'envoi (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "connexion interrompue"));
    xhr.onabort = () => reject(new ApiError(0, "envoi annulé"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    xhr.send(file);
  });
}

export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  avatarKey?: string | null;
  phone?: string | null;
  /** Whether a password is set at all — checkout-created accounts have none. */
  hasPassword?: boolean;
};
export type MarketCard = Market & { coverUrl: string | null; storeCount?: number };
export type StoreCard = Store & { logoUrl: string | null };
export type ProductCard = Product & { imageUrl: string | null };
export type CartLine = {
  lineId: string;
  productId: string;
  variantId: string;
  variantLabel: string | null;
  storeId: string;
  name: string;
  priceMinor: number;
  stock: number;
  imageKey: string | null;
  qty: number;
  storeName: string;
  marketName: string;
};

export type ProductOption = { id: string; name: string; values: string[]; position: number };
export type ProductVariant = {
  id: string;
  options: Record<string, string>;
  label: string;
  sku: string | null;
  priceMinor: number;
  stock: number;
};
export type ReviewItem = {
  id: string;
  rating: number;
  body: string | null;
  createdAt: number;
  author: string;
};
export type AvailableDelivery = {
  id: string;
  createdAt: number;
  orderRef: string;
  totalMinor: number;
  /** What the run pays the courier — not the basket total. */
  feeMinor: number;
  storeName: string;
  marketName: string;
  city: string;
  lat: number;
  lng: number;
  /** Destination is coarse until the run is claimed. */
  dropCity: string | null;
  dropLat: number | null;
  dropLng: number | null;
};

/** A claimed run: pickup, drop-off and who to call at each end. */
export type MyDelivery = {
  id: string;
  status: "UNASSIGNED" | "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "FAILED";
  proofKey: string | null;
  createdAt: number;
  orderRef: string;
  totalMinor: number;
  feeMinor: number;
  storeName: string;
  storePhone: string | null;
  marketName: string;
  lat: number;
  lng: number;
  customerName: string;
  customerPhone: string | null;
  dropLine1: string | null;
  dropCity: string | null;
  dropLat: number | null;
  dropLng: number | null;
  dropNotes: string | null;
};

export type MapBounds = { north: number; south: number; east: number; west: number };

export type SearchHit = { id: string; name: string; priceMinor: number; currency: string; imageUrl: string | null; storeName: string };
export type MyStore = {
  id: string;
  name: string;
  slug: string;
  status: string;
  marketId: string;
  marketName: string;
  logoKey?: string | null;
  description?: string | null;
  phone?: string | null;
  category?: string | null;
};
export type StoreOrder = {
  id: string; ref: string; status: Order["status"]; totalMinor: number; currency: string;
  createdAt: number; customerName: string;
  items: { id: string; name: string; qty: number; unitPriceMinor: number }[];
};
export type AdminUser = { id: string; name: string; email: string | null; role: string; status: string; createdAt: number };
export type PendingStore = { id: string; name: string; createdAt: number; marketName: string; ownerName: string; ownerEmail: string | null };
export type AdminMarket = {
  id: string;
  slug: string;
  name: string;
  nameAr: string | null;
  city: string;
  description: string | null;
  lat: number;
  lng: number;
  status: "ACTIVE" | "HIDDEN";
  storeCount: number;
  coverKey?: string | null;
};

/** What a merchant may change about one of their products. */
export type ProductInput = {
  name?: string;
  description?: string | null;
  priceMinor?: number;
  stock?: number;
  imageKey?: string | null;
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
};

/** What an admin may send when creating or editing a souk. */
export type MarketInput = {
  name?: string;
  nameAr?: string | null;
  city?: string;
  description?: string | null;
  lat?: number;
  lng?: number;
  coverKey?: string | null;
  status?: "ACTIVE" | "HIDDEN";
};

export const api = {
  me: () => get<{ user: SessionUser | null }>("/auth/me"),
  login: (email: string, password: string) =>
    post<{ user: SessionUser }>("/auth/login", { email, password }),
  register: (input: Record<string, unknown>) => post<{ user: SessionUser }>("/auth/register", input),
  logout: () => post<{ ok: true }>("/auth/logout"),
  setPassword: (password: string, current?: string) =>
    post<{ ok: true }>("/auth/password", { password, current }),
  forgotPassword: (email: string) =>
    post<{ ok: true; delivered: boolean }>("/auth/password/forgot", { email }),
  resetPassword: (token: string, password: string) =>
    post<{ user: SessionUser }>("/auth/password/reset", { token, password }),
  adminResetLink: (userId: string) =>
    post<{ url: string; expiresAt: number }>(`/admin/users/${userId}/reset-link`),

  markets: (params: { city?: string; q?: string } = {}) =>
    get<{ markets: MarketCard[] }>(`/markets?${new URLSearchParams(params as Record<string, string>)}`),
  marketsInBounds: (b: MapBounds) =>
    get<{ markets: MarketCard[] }>(
      `/markets/bounds?${new URLSearchParams({
        north: String(b.north),
        south: String(b.south),
        east: String(b.east),
        west: String(b.west),
      })}`,
    ),
  market: (id: string) => get<{ market: MarketCard }>(`/markets/${id}`),
  marketStores: (id: string) => get<{ stores: StoreCard[] }>(`/markets/${id}/stores`),
  store: (id: string) => get<{ store: StoreCard }>(`/stores/${id}`),
  storeProducts: (id: string) => get<{ products: ProductCard[] }>(`/stores/${id}/products`),

  product: (id: string) => get<{ product: ProductCard }>(`/products/${id}`),
  search: (q: string) =>
    get<{ markets: MarketCard[]; stores: StoreCard[]; products: SearchHit[]; total: number }>(
      `/search?q=${encodeURIComponent(q)}`,
    ),

  cart: () => get<{ cartId: string; lines: CartLine[]; subtotalMinor: number }>("/cart"),
  addToCart: (productId: string, qty = 1, variantId = "") =>
    post<{ ok: true }>("/cart/items", { productId, variantId, qty }),
  removeFromCart: (lineId: string) => del<{ ok: true }>(`/cart/items/${lineId}`),
  setCartQty: (lineId: string, qty: number) => patch<{ ok: true }>(`/cart/items/${lineId}`, { qty }),

  addresses: () => get<{ addresses: { id: string; label: string | null; line1: string; city: string }[] }>("/addresses"),
  createAddress: (input: Record<string, unknown>) => post<{ address: { id: string } }>("/addresses", input),

  orders: () => get<{ orders: Order[] }>("/orders"),
  order: (id: string) => get<{ order: Order; items: { id: string; name: string; qty: number; unitPriceMinor: number }[] }>(`/orders/${id}`),
  checkout: (body: {
    addressId?: string;
    address?: Record<string, unknown>;
    guest?: { name: string; email: string; phone?: string; password?: string };
    paymentMethod?: "COD" | "CARD";
  }) => post<{ order: Order }>("/orders", { paymentMethod: "COD", ...body }),

  variants: (productId: string) =>
    get<{ options: ProductOption[]; variants: ProductVariant[] }>(`/products/${productId}/variants`),
  saveVariants: (productId: string, body: unknown) =>
    request<{ ok: true }>(`/products/${productId}/variants`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  storeReviews: (id: string) =>
    get<{ reviews: ReviewItem[]; count: number; average: number }>(`/stores/${id}/reviews`),
  productReviews: (id: string) =>
    get<{ reviews: ReviewItem[]; count: number; average: number }>(`/products/${id}/reviews`),
  postReview: (input: { rating: number; body?: string; storeId?: string; productId?: string }) =>
    post<{ review: unknown }>("/reviews", input),

  applyAsSeller: (input: Record<string, unknown>) =>
    post<{ store: MyStore }>("/seller/apply", input),
  applyAsDeliverer: (input: Record<string, unknown>) =>
    post<{ ok: true }>("/deliverer/apply", input),
  requestMarket: (input: { name: string; city: string; note?: string }) =>
    post<{ request: { id: string } }>("/market-requests", input),
  adminMarketRequests: () =>
    get<{
      requests: {
        id: string;
        name: string;
        city: string;
        note: string | null;
        status: string;
        createdAt: number;
        requestedBy: string;
      }[];
    }>("/admin/market-requests"),
  adminResolveMarketRequest: (id: string, status: "APPROVED" | "REJECTED") =>
    post<{ ok: true }>(`/admin/market-requests/${id}`, { status }),

  updateProfile: (input: { name?: string; phone?: string; avatarKey?: string | null }) =>
    patch<{ user: SessionUser & { avatarKey: string | null } }>("/me", input),
  updateStore: (
    id: string,
    input: { name?: string; description?: string; phone?: string; category?: string; logoKey?: string | null },
  ) => patch<{ store: StoreCard }>(`/stores/${id}`, input),
  updateMarket: (id: string, input: MarketInput) =>
    patch<{ market: MarketCard }>(`/admin/markets/${id}`, input),
  createMarket: (input: MarketInput & { name: string; city: string; lat: number; lng: number }) =>
    post<{ market: MarketCard }>("/admin/markets", input),

  myStores: () => get<{ stores: MyStore[] }>("/me/stores"),
  /** Owner view: drafts and archives included, unlike the public listing. */
  storeCatalogue: (id: string) => get<{ products: ProductCard[] }>(`/stores/${id}/catalogue`),
  updateProduct: (id: string, input: ProductInput) =>
    patch<{ product: ProductCard }>(`/products/${id}`, input),
  archiveProduct: (id: string) => del<{ ok: true }>(`/products/${id}`),
  storeKpis: (id: string) =>
    get<{ orderCount: number; revenueMinor: number; productCount: number }>(`/stores/${id}/kpis`),
  storeOrders: (id: string) => get<{ orders: StoreOrder[] }>(`/stores/${id}/orders`),
  setOrderStatus: (id: string, status: "CONFIRMED" | "PREPARING" | "READY" | "CANCELLED") =>
    patch<{ ok: true }>(`/orders/${id}/status`, { status }),
  createStore: (input: Record<string, unknown>) => post<{ store: MyStore }>("/stores", input),
  createProduct: (storeId: string, input: Record<string, unknown>) =>
    post<{ product: ProductCard }>(`/stores/${storeId}/products`, input),

  adminKpis: () =>
    get<{ users: number; stores: number; markets: number; orders: number; gmvMinor: number }>("/admin/kpis"),
  adminPending: () => get<{ stores: PendingStore[] }>("/admin/pending"),
  adminApprove: (id: string) => post<{ ok: true }>(`/admin/stores/${id}/approve`),
  adminReject: (id: string) => post<{ ok: true }>(`/admin/stores/${id}/reject`),
  adminUsers: () => get<{ users: AdminUser[] }>("/admin/users"),
  adminSetUserStatus: (id: string, status: "ACTIVE" | "SUSPENDED") =>
    post<{ ok: true }>(`/admin/users/${id}/status`, { status }),
  adminMarkets: () => get<{ markets: AdminMarket[] }>("/admin/markets"),

  availableDeliveries: () => get<{ deliveries: AvailableDelivery[] }>("/deliveries/available"),
  myDeliveries: () => get<{ deliveries: MyDelivery[] }>("/deliveries/mine"),
  acceptDelivery: (id: string) => post<{ delivery: Delivery }>(`/deliveries/${id}/accept`),
  markPickedUp: (id: string) => post<{ ok: true }>(`/deliveries/${id}/picked-up`),
  markDelivered: (id: string, proofKey?: string | null) =>
    post<{ ok: true }>(`/deliveries/${id}/delivered`, { proofKey: proofKey ?? undefined }),
  pingLocation: (id: string, lat: number, lng: number) =>
    post<{ ok: true }>(`/deliveries/${id}/location`, { lat, lng }),
};

/** 4900 -> "49,00 MAD". Formatting lives here so no component reinvents it. */
export const money = (minor: number, currency = "MAD") =>
  new Intl.NumberFormat("fr-MA", { style: "currency", currency }).format(minor / 100);
