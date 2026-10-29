CREATE TABLE `expense_payers` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`settlement_amount` integer NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expense_payers_amount_check" CHECK("expense_payers"."amount" > 0),
	CONSTRAINT "expense_payers_settlement_amount_check" CHECK("expense_payers"."settlement_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_payers_expense_member_unique` ON `expense_payers` (`expense_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `expense_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`member_id` text NOT NULL,
	`share_units` integer DEFAULT 1 NOT NULL,
	`settlement_amount` integer NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expense_splits_share_units_check" CHECK("expense_splits"."share_units" BETWEEN 1 AND 99),
	CONSTRAINT "expense_splits_settlement_amount_check" CHECK("expense_splits"."settlement_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_splits_expense_member_unique` ON `expense_splits` (`expense_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`creator_member_id` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`original_amount` integer NOT NULL,
	`original_currency` text NOT NULL,
	`fx_rate_scaled` integer NOT NULL,
	`fx_date` text NOT NULL,
	`is_custom_rate` integer DEFAULT false NOT NULL,
	`settlement_amount` integer NOT NULL,
	`split_type` text NOT NULL,
	`expense_date` text NOT NULL,
	`expense_time` text,
	`stop_id` text,
	`receipt_key` text,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stop_id`) REFERENCES `stops`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "expenses_original_amount_check" CHECK("expenses"."original_amount" BETWEEN 1 AND 99999999),
	CONSTRAINT "expenses_original_currency_check" CHECK("expenses"."original_currency" IN ('TWD', 'USD', 'JPY', 'THB')),
	CONSTRAINT "expenses_fx_rate_check" CHECK("expenses"."fx_rate_scaled" > 0),
	CONSTRAINT "expenses_is_custom_rate_check" CHECK("expenses"."is_custom_rate" IN (0, 1)),
	CONSTRAINT "expenses_settlement_amount_check" CHECK("expenses"."settlement_amount" >= 0),
	CONSTRAINT "expenses_split_type_check" CHECK("expenses"."split_type" IN ('equal', 'exact', 'shares'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_idempotency_key_unique` ON `expenses` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `expenses_group_date_idx` ON `expenses` (`group_id`,`expense_date`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`rate_date` text NOT NULL,
	`base_currency` text NOT NULL,
	`quote_currency` text NOT NULL,
	`rate_scaled` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`rate_date`, `base_currency`, `quote_currency`),
	CONSTRAINT "fx_rates_rate_check" CHECK("fx_rates"."rate_scaled" > 0)
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`settlement_currency` text DEFAULT 'TWD' NOT NULL,
	`default_expense_currency` text DEFAULT 'TWD' NOT NULL,
	`is_trip` integer DEFAULT false NOT NULL,
	`trip_destination` text,
	`trip_start_date` text,
	`trip_end_date` text,
	`trip_notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "groups_settlement_currency_check" CHECK("groups"."settlement_currency" IN ('TWD', 'USD', 'JPY', 'THB')),
	CONSTRAINT "groups_default_expense_currency_check" CHECK("groups"."default_expense_currency" IN ('TWD', 'USD', 'JPY', 'THB')),
	CONSTRAINT "groups_is_trip_check" CHECK("groups"."is_trip" IN (0, 1)),
	CONSTRAINT "groups_trip_dates_check" CHECK("groups"."trip_start_date" IS NULL OR "groups"."trip_end_date" IS NULL OR "groups"."trip_end_date" >= "groups"."trip_start_date")
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_sub` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "identities_provider_check" CHECK("identities"."provider" IN ('google', 'line'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identities_provider_sub_unique` ON `identities` (`provider`,`provider_sub`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text,
	`placeholder_name` text,
	`nickname` text,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`net_balance` integer DEFAULT 0 NOT NULL,
	`created_by_member_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "members_role_check" CHECK("members"."role" IN ('admin', 'member')),
	CONSTRAINT "members_status_check" CHECK("members"."status" IN ('active', 'former', 'placeholder')),
	CONSTRAINT "members_placeholder_check" CHECK("members"."status" <> 'placeholder' OR ("members"."user_id" IS NULL AND "members"."placeholder_name" IS NOT NULL)),
	CONSTRAINT "members_active_user_check" CHECK("members"."status" <> 'active' OR "members"."user_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_group_user_unique` ON `members` (`group_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `rate_counters` (
	`user_id` text NOT NULL,
	`route_group` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `route_group`, `window_start`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`user_agent` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_refresh_token_hash_unique` ON `sessions` (`refresh_token_hash`);--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`payer_member_id` text NOT NULL,
	`receiver_member_id` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`confirmed_at` integer,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payer_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receiver_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settlements_amount_check" CHECK("settlements"."amount" > 0),
	CONSTRAINT "settlements_distinct_members_check" CHECK("settlements"."payer_member_id" <> "settlements"."receiver_member_id"),
	CONSTRAINT "settlements_status_check" CHECK("settlements"."status" IN ('pending', 'confirmed', 'cancelled', 'undone'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_idempotency_key_unique` ON `settlements` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `settlements_group_created_idx` ON `settlements` (`group_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `stops` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`day_date` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`location_name` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "stops_time_order_check" CHECK("stops"."start_time" IS NULL OR "stops"."end_time" IS NULL OR "stops"."end_time" >= "stops"."start_time")
);
--> statement-breakpoint
CREATE INDEX `stops_group_day_idx` ON `stops` (`group_id`,`day_date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`picture_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
