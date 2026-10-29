ALTER TABLE `expense_splits` ADD `amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `fx_rates` ADD `published_date` text;