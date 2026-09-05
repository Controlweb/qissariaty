import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { withUser } from "./auth";
import { auth } from "./routes/auth";
import { catalog } from "./routes/catalog";
import { commerce } from "./routes/commerce";
import { delivery } from "./routes/deliveries";
import { media } from "./routes/media";
import { manage } from "./routes/manage";
import { extras } from "./routes/reviews";
import { onboarding } from "./routes/onboarding";
import { runCleanup } from "./scale";
import type { AppEnv, QueueEvent } from "./types";

export { DeliveryRoom } from "./delivery-room";

const app = new Hono<AppEnv>().basePath("/api");

app.use(secureHeaders());
app.use(withUser);

app.route("/auth", auth);
app.route("/", catalog);
app.route("/", commerce);
app.route("/", delivery);
app.route("/", media);
app.route("/", manage);
app.route("/", extras);
app.route("/", onboarding);

app.get("/health", (c) => c.json({ ok: true, env: c.env.APP_ENV }));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  // Log the real error, return an opaque one — stack traces are not a public API.
  console.error("unhandled", err);
  return c.json({ error: "internal error" }, 500);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

export default {
  fetch: app.fetch,

  /**
   * Daily hygiene (Cron Trigger `0 3 * * *` in wrangler.jsonc): expired
   * sessions, orphan guest carts, spent reset tokens. Without this the auth
   * join in withUser slows down for everyone as the tables grow.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runCleanup(env).then(
        (r) => console.log("cleanup", r),
        (err) => console.error("cleanup failed", err),
      ),
    );
  },

  /**
   * Everything that must happen after an order but not during it: store and
   * deliverer notifications, receipts, analytics. Retries are automatic, so
   * handlers must be idempotent.
   */
  async queue(batch: MessageBatch<QueueEvent>, env: Env) {
    for (const message of batch.messages) {
      try {
        switch (message.body.type) {
          case "order.created":
            console.log("notify store", message.body.storeId, "of", message.body.orderId);
            break;
          case "order.status":
            console.log("order", message.body.orderId, "->", message.body.status);
            break;
          case "delivery.assigned":
            console.log("delivery", message.body.deliveryId, "taken by", message.body.delivererId);
            break;
          case "delivery.completed":
            console.log("delivery", message.body.deliveryId, "completed");
            break;
        }
        message.ack();
      } catch (err) {
        console.error("queue handler failed", message.body, err);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, QueueEvent>;
