# Qissariaty

Marketplace for Moroccan qissariat / souks: find markets on a map, browse the
stores inside them, order, and track delivery live.

Runs entirely on Cloudflare Workers — no origin server, no container.

| Layer          | Choice                                     |
| -------------- | ------------------------------------------ |
| Frontend       | React 19 + TypeScript + Vite               |
| Design system  | Organic (imported from Claude Design)      |
| Backend        | Hono on Cloudflare Workers                 |
| Database       | Cloudflare D1 + Drizzle ORM                |
| Files / images | Cloudflare R2                              |
| Background     | Cloudflare Queues                          |
| Realtime       | Durable Objects (WebSocket hibernation)    |
| Validation     | Zod, shared by client and worker           |
| Server state   | TanStack Query                             |
| UI state       | Zustand                                    |
| Maps           | Leaflet + OpenStreetMap                    |
| Testing        | Vitest (workers pool) + Playwright         |
| Deployment     | Wrangler + Workers Static Assets           |

## Layout

```
worker/            Hono API, Durable Object, queue consumer
  schema.ts        Drizzle schema (source of truth for migrations)
  auth.ts          PBKDF2 hashing, session cookie, role middleware
  routes/          auth · catalog · commerce · deliveries · media · manage
shared/            Zod schemas imported by both sides
src/
  organic.css      The design system, verbatim from Claude Design
  index.css        App-level styles from the design file's <helmet>
  pages/           One file per screen
design/            The exported .dc.html artboard, for reference
migrations/        Generated SQL — never hand-edit
tests/             Vitest against the real Worker + D1
e2e/               Playwright
```

## Design

The UI is ported from the **Organic** design system in Claude Design
(project `b665c818-8c89-42c4-a750-83a5cfef4065`). Rules that matter:

- **`src/organic.css` is copied verbatim — do not edit it by hand.** Re-export
  from Claude Design instead, or the two drift apart.
- **Take every colour, font, space and radius from a token** (`var(--color-*)`,
  `var(--font-*)`, `var(--space-*)`, `var(--radius-*)`). Never hard-code a hex.
- **Use the system's classes** — `.btn`, `.card`, `.tag`, `.input`, `.table`,
  `.field` — rather than inventing parallel ones. There is no Tailwind here on
  purpose: two systems would fight.
- Photography goes through `<Ph>`, which renders the design's hatched slot at
  the intended dimensions until a real R2 image exists.

Screens still to port from the artboard: the immersive map variant, the
editorial market variant, product variants/combos, and customer reviews.

One project, not a monorepo: a single `vite build` emits both the client bundle
and the Worker, and one `wrangler deploy` ships them together. Split into
`apps/` + `packages/` when a second deployable actually exists.

## First run

```bash
pnpm install

wrangler d1 create qissariaty  # paste database_id into wrangler.jsonc
wrangler r2 bucket create qissariaty-media
wrangler queues create qissariaty-events
wrangler queues create qissariaty-events-dlq

pnpm cf-typegen                # regenerate Env types after binding changes
pnpm db:migrate:local
pnpm db:seed
pnpm dev                       # http://localhost:5173
```

## Day to day

```bash
pnpm dev                # Vite + Workers runtime together
pnpm test               # Vitest against a real local D1
pnpm test:e2e           # Playwright
pnpm db:generate        # after editing worker/schema.ts
pnpm db:migrate:local
pnpm deploy             # build + wrangler deploy
```

`pnpm cf-typegen` must be re-run whenever `wrangler.jsonc` bindings change —
`Env` is generated, not hand-written.

## API

```
POST   /api/auth/register        POST /api/auth/login    POST /api/auth/logout
GET    /api/auth/me

GET    /api/markets              GET  /api/markets/bounds?north&south&east&west
GET    /api/markets/:id          GET  /api/markets/:id/stores
GET    /api/stores/:id           GET  /api/stores/:id/products
GET    /api/products/:id         GET  /api/categories
GET    /api/search?q=
POST   /api/stores               POST /api/stores/:id/products
PATCH  /api/products/:id         DELETE /api/products/:id

GET    /api/cart                 POST /api/cart/items
DELETE /api/cart/items/:productId
GET    /api/addresses            POST /api/addresses
POST   /api/orders               GET  /api/orders    GET /api/orders/:id

GET    /api/deliveries/available GET  /api/deliveries/mine
POST   /api/deliveries/:id/accept
POST   /api/deliveries/:id/picked-up
POST   /api/deliveries/:id/delivered
POST   /api/deliveries/:id/location
GET    /api/deliveries/:id/socket   (WebSocket, live tracking)

GET    /api/me/stores            GET  /api/stores/:id/kpis
GET    /api/stores/:id/orders    PATCH /api/orders/:id/status
PATCH  /api/cart/items/:productId

GET    /api/admin/kpis           GET  /api/admin/pending
POST   /api/admin/stores/:id/approve
POST   /api/admin/stores/:id/reject
GET    /api/admin/users          POST /api/admin/users/:id/status
GET    /api/admin/markets

POST   /api/media/:prefix        GET  /api/media/*
```

## Conventions worth knowing

- **Money is integer centimes.** `4900` is 49,00 MAD. Nothing stores a float.
- **Never query markets without bounds.** `boundsSchema` rejects viewports wider
  than 2° so a zoomed-out map cannot ask for every market in Morocco.
- **Images live in R2, keys live in D1.** Public URLs are built from
  `MEDIA_PUBLIC_BASE`; point that at an R2 custom domain in production so reads
  bypass the Worker entirely.
- **Location pings go to the Durable Object, not D1.** Only milestones
  (accepted, picked up, delivered) are persisted.
- **Anything that can wait goes on the queue.** Notifications, receipts and
  analytics must never sit between the customer and their order confirmation.

## Demo accounts

`pnpm db:seed` creates three accounts, all with the password **`qissariaty-dev`**:

| Email | Role |
| --- | --- |
| `owner@qissariaty.ma` | Store owner (two shops in Qissariat Habous) |
| `deliverer@qissariaty.ma` | Deliverer |
| `admin@qissariaty.ma` | Admin |

## Password recovery and email

Two recovery paths exist, and only one of them needs any setup.

**Admin-issued link (works today).** Admin → Utilisateurs → *Réinitialiser* mints a
one-time link, valid 24 h, shown once. Hand it over by phone or WhatsApp. Nothing
external is involved. This is also the only way back in for an account created at
checkout, which has no password until its owner sets one from `/compte`.

**Self-service `/mot-de-passe-oublie` (needs configuration).** Posts to
`/api/auth/password/forgot`, which mails the same kind of link through the
Cloudflare Email Service `send_email` binding. The code is wired and tested; the
send currently fails in production because the prerequisites below are unmet.

To make sending work:

1. ~~An active zone.~~ **Done.** `preview-web.site` is active on Cloudflare
   (nameservers `keaton`/`selah.ns.cloudflare.com`).
2. ~~Enable Email Routing.~~ **Done** — `wrangler email routing enable
   preview-web.site`, now `Enabled: true, Status: ready`. The domain had no MX
   records beforehand, so no existing mail flow was disturbed.
3. **Onboard the domain for Email *Sending*.** `wrangler email sending enable
   preview-web.site` currently fails with `Unauthorized [code: 2036]`: the
   active auth profile has no Email Sending scope. Fix the token (or do it in
   the dashboard under Compute → Email Service → Domains), then publish the
   SPF/DKIM/DMARC records it hands you.
4. **Workers Paid plan.** Sending to arbitrary recipients is a paid feature;
   3,000 emails/month included. Sends to verified destinations are free.
5. Point `EMAIL_FROM` in `wrangler.jsonc` at an address on that domain.

Shortcut for testing before step 3: `wrangler email routing addresses create
you@example.com`, click the verification mail, and resets to *that* address will
send for free on any plan. Every other recipient still fails until the sending
domain is onboarded.

Until then the endpoint stays safe rather than helpful: it answers identically for
every address, so it can never be used to discover which emails have accounts, and
the confirmation screen always offers the human fallback.

> The response deliberately does **not** report whether a message actually left.
> An earlier version returned `delivered: false` when a send threw, which — with
> sending broken — made a real account distinguishable from an invented one. The
> flag is now derived from configuration alone, before the account is looked up.

## Known ceilings

- **Checkout compensates, it does not roll back.** D1 has no interactive
  transactions, so `POST /api/orders` takes stock with guarded decrements and
  undoes the successful ones if any line loses the race. If the compensating
  write itself fails, stock is under-counted until the store corrects it. Move
  reservations into a per-store Durable Object if oversell pressure justifies
  serialising checkout.
- **One order = one store.** Mixed carts are rejected at checkout rather than
  split. Splitting is a schema-compatible change when it is worth doing.
- **Delivery fee is a flat 1500 centimes** in `worker/routes/commerce.ts`.
  Replace with a distance or zone table when pricing is decided.
- **Payments are cash-on-delivery only.** `paymentMethod: "CARD"` is accepted by
  the schema but no processor is wired up; the checkout UI says so.
- **PBKDF2 is capped at 100,000 iterations.** Workers rejects more — the OWASP
  210,000 figure throws at runtime while passing locally under `workerd`. If
  this ever needs strengthening, the format string carries its own iteration
  count, so raising it is a compatible change.
- **`MEDIA_PUBLIC_BASE` is `/api/media`**, so images are served by the Worker.
  Point it at an R2 custom domain to make image reads bypass the Worker.
- **Search is FTS5 first, `LIKE` fallback** (`worker/routes/catalog.ts`,
  migration `0006`). FTS handles prefix + diacritics; weird queries fall back
  rather than 500ing.

## Scale on Cloudflare (P0 → P2 shipped)

- **Cron `0 3 * * *`** (`wrangler.jsonc:triggers`, `worker/scale.ts`):
  `runCleanup` deletes expired sessions, orphan guest carts (30d) and spent
  reset tokens; `runReconciliation` logs order/delivery drift and repairs
  `markets.store_count`. Watch `cleanup` / `reconciliation` logs.
- **Catalog edge cache** (`worker/scale.ts:cachedJson`): `/markets/bounds`,
  `/markets`, `/markets/:id`, `/stores/:id/products`, `/categories` cache
  60–300s in `caches.default`. Authenticated routes never cache.
- **Location throttle**: client pings max 1/5s (`DelivererBoard.tsx`), DO
  broadcasts max 1/3s (`delivery-room.ts:publishLocation` returns
  `{ throttled }`). Pings stay in DO storage, never D1.
- **Abuse**: dashboard Rate Limit + WAF on `/api/auth/*`, `/api/orders`,
  `/api/search`, `/api/media/*` (preferred). In-code `RATE_LIMITER` backstop
  (`worker/scale.ts:checkRateLimit`, fails open) + optional Turnstile:
  `wrangler secret put TURNSTILE_SECRET_KEY`, client sends `turnstileToken`.
- **D1**: indexes on `sessions.expires_at`, `deliveries.status`,
  `carts.created_at`, `password_resets.expires_at` (0004);
  `markets.store_count` denormalized via triggers + backfill (0005–0006);
  `/markets` supports `?cursor=base64(createdAt:id)` keyset pagination;
  checkout takes `Idempotency-Key` (stored `orders.idempotency_key UNIQUE`,
  double tap returns `{ deduped: true }`).
- **Deliveries**: `/deliveries/available?city=` filters by souk city
  (`markets.city` index) so couriers don't all poll one global 50.
- **R2**: set `MEDIA_PUBLIC_BASE=https://media.preview-web.site` after adding
  the R2 custom domain; reads then skip the Worker entirely. Keep immutable
  `cache-control` from `media.ts`.
- **Frontend**: `MapSplit`, `Admin`, `StoreDashboard`, `DelivererBoard` are
  `React.lazy` (`App.tsx`) so Leaflet/dashboards don't bloat first paint.
- **Still manual (Cloudflare dashboard)**: Workers Paid plan (Email sending,
  higher CPU), Email Sending domain onboarding (SPF/DKIM/DMARC), DLQ depth
  alert, `preview` env + separate D1 before load tests.
