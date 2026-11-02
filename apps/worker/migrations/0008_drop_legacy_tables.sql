-- Release 2: Drop legacy group tables and establish durable settlement routes and invite lookup
CREATE TABLE IF NOT EXISTS `settlement_routes` (
	`settlement_id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `settlement_routes_group_id_idx` ON `settlement_routes` (`group_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `settlement_routes` (`settlement_id`, `group_id`, `created_at`)
	SELECT `id`, `group_id`, `created_at` FROM `settlements`;
--> statement-breakpoint
CREATE TABLE `invites_lookup` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_lookup_token_unique` ON `invites_lookup` (`token`);
--> statement-breakpoint
INSERT INTO `invites_lookup` SELECT `id`, `group_id`, `token`, `expires_at`, `created_at` FROM `invites`;
--> statement-breakpoint
DROP TABLE `invites`;
--> statement-breakpoint
ALTER TABLE `invites_lookup` RENAME TO `invites`;
--> statement-breakpoint
DROP TABLE `expense_splits`;
--> statement-breakpoint
DROP TABLE `expense_payers`;
--> statement-breakpoint
DROP TABLE `expenses`;
--> statement-breakpoint
DROP TABLE `settlements`;
--> statement-breakpoint
DROP TABLE `stops`;
--> statement-breakpoint
DROP TABLE `members`;
--> statement-breakpoint
DROP TABLE `groups`;
--> statement-breakpoint
DROP TABLE IF EXISTS `migration_wipe_pending`;
