CREATE TABLE `deliverer_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`vehicle` text NOT NULL,
	`plate` text,
	`id_number` text,
	`id_doc_key` text,
	`city` text NOT NULL,
	`zones` text NOT NULL,
	`availability` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `market_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`city` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `market_requests_status_idx` ON `market_requests` (`status`);--> statement-breakpoint
ALTER TABLE `stores` ADD `category` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `registry_number` text;