-- P1 scale: denormalized store counts + FTS5 search.
-- Hand-written (drizzle-kit does not generate FTS virtual tables or triggers).
-- Safe to run after 0005 (adds markets.store_count / orders.idempotency_key).

-- Backfill the denormalized counter from current data.
UPDATE `markets` SET `store_count` = (SELECT COUNT(*) FROM `stores` s WHERE s.`market_id` = `markets`.`id` AND s.`status` = 'ACTIVE');
--> statement-breakpoint
-- Keep it correct without application races: approve/reject/move all flow
-- through UPDATE/INSERT/DELETE on stores.
CREATE TRIGGER `stores_count_ai` AFTER INSERT ON `stores` WHEN NEW.`status` = 'ACTIVE' BEGIN UPDATE `markets` SET `store_count` = `store_count` + 1 WHERE `id` = NEW.`market_id`; END;
--> statement-breakpoint
CREATE TRIGGER `stores_count_ad` AFTER DELETE ON `stores` WHEN OLD.`status` = 'ACTIVE' BEGIN UPDATE `markets` SET `store_count` = `store_count` - 1 WHERE `id` = OLD.`market_id`; END;
--> statement-breakpoint
CREATE TRIGGER `stores_count_au` AFTER UPDATE ON `stores` WHEN OLD.`status` IS NOT NEW.`status` OR OLD.`market_id` IS NOT NEW.`market_id` BEGIN UPDATE `markets` SET `store_count` = `store_count` - 1 WHERE `id` = OLD.`market_id` AND OLD.`status` = 'ACTIVE'; UPDATE `markets` SET `store_count` = `store_count` + 1 WHERE `id` = NEW.`market_id` AND NEW.`status` = 'ACTIVE'; END;
--> statement-breakpoint
-- FTS5 tables. Standalone (no content-sync) because ids are TEXT UUIDs, not
-- rowids. unicode61 with remove_diacritics so "cafe" matches "café".
CREATE VIRTUAL TABLE `products_fts` USING fts5(`id` UNINDEXED, `name`, `description`, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE VIRTUAL TABLE `markets_fts` USING fts5(`id` UNINDEXED, `name`, `city`, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE VIRTUAL TABLE `stores_fts` USING fts5(`id` UNINDEXED, `name`, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `products_fts_ai` AFTER INSERT ON `products` BEGIN INSERT INTO `products_fts`(`id`, `name`, `description`) VALUES (NEW.`id`, NEW.`name`, NEW.`description`); END;
--> statement-breakpoint
CREATE TRIGGER `products_fts_ad` AFTER DELETE ON `products` BEGIN DELETE FROM `products_fts` WHERE `id` = OLD.`id`; END;
--> statement-breakpoint
CREATE TRIGGER `products_fts_au` AFTER UPDATE ON `products` WHEN OLD.`name` IS NOT NEW.`name` OR OLD.`description` IS NOT NEW.`description` BEGIN DELETE FROM `products_fts` WHERE `id` = OLD.`id`; INSERT INTO `products_fts`(`id`, `name`, `description`) VALUES (NEW.`id`, NEW.`name`, NEW.`description`); END;
--> statement-breakpoint
CREATE TRIGGER `markets_fts_ai` AFTER INSERT ON `markets` BEGIN INSERT INTO `markets_fts`(`id`, `name`, `city`) VALUES (NEW.`id`, NEW.`name`, NEW.`city`); END;
--> statement-breakpoint
CREATE TRIGGER `markets_fts_ad` AFTER DELETE ON `markets` BEGIN DELETE FROM `markets_fts` WHERE `id` = OLD.`id`; END;
--> statement-breakpoint
CREATE TRIGGER `markets_fts_au` AFTER UPDATE ON `markets` WHEN OLD.`name` IS NOT NEW.`name` OR OLD.`city` IS NOT NEW.`city` BEGIN DELETE FROM `markets_fts` WHERE `id` = OLD.`id`; INSERT INTO `markets_fts`(`id`, `name`, `city`) VALUES (NEW.`id`, NEW.`name`, NEW.`city`); END;
--> statement-breakpoint
CREATE TRIGGER `stores_fts_ai` AFTER INSERT ON `stores` BEGIN INSERT INTO `stores_fts`(`id`, `name`) VALUES (NEW.`id`, NEW.`name`); END;
--> statement-breakpoint
CREATE TRIGGER `stores_fts_ad` AFTER DELETE ON `stores` BEGIN DELETE FROM `stores_fts` WHERE `id` = OLD.`id`; END;
--> statement-breakpoint
CREATE TRIGGER `stores_fts_au` AFTER UPDATE ON `stores` WHEN OLD.`name` IS NOT NEW.`name` BEGIN DELETE FROM `stores_fts` WHERE `id` = OLD.`id`; INSERT INTO `stores_fts`(`id`, `name`) VALUES (NEW.`id`, NEW.`name`); END;
--> statement-breakpoint
INSERT INTO `products_fts`(`id`, `name`, `description`) SELECT `id`, `name`, `description` FROM `products`;
--> statement-breakpoint
INSERT INTO `markets_fts`(`id`, `name`, `city`) SELECT `id`, `name`, `city` FROM `markets`;
--> statement-breakpoint
INSERT INTO `stores_fts`(`id`, `name`) SELECT `id`, `name` FROM `stores`;
