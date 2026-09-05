DROP INDEX `orders_idempotency_key_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_customer_idempotency_idx` ON `orders` (`customer_id`,`idempotency_key`);